#!/usr/bin/env python3
import hashlib
import json
import sys
from pathlib import Path

EVALUATOR_ID = "evaluator:clip-hybrid"
EVALUATOR_VERSION = "0.1.0"


def artifact(path):
    from PIL import Image
    import numpy as np

    target = Path(path)
    payload = target.read_bytes()
    with Image.open(target) as image:
        rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[:, :, 3]
    rgb = rgba[:, :, :3]
    non_empty = (alpha > 0) & np.any(rgb > 0, axis=2)
    return {
        "decoded": True,
        "width": int(rgba.shape[1]),
        "height": int(rgba.shape[0]),
        "bytes": len(payload),
        "nonEmptyPixels": int(non_empty.sum()),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def normalized_histogram(values, bins=32):
    import numpy as np

    histogram, _ = np.histogram(values, bins=bins, range=(0, 256))
    result = histogram.astype(np.float64)
    total = float(result.sum())
    return result / total if total else result


def color_histogram(path):
    from PIL import Image
    import numpy as np

    with Image.open(path) as image:
        rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    return np.concatenate([normalized_histogram(rgb[:, :, channel]) for channel in range(3)])


def line_histogram(path):
    from PIL import Image
    import numpy as np

    with Image.open(path) as image:
        gray = np.asarray(image.convert("L"), dtype=np.float64)
    gradient_x = np.diff(gray, axis=1, prepend=gray[:, :1])
    gradient_y = np.diff(gray, axis=0, prepend=gray[:1, :])
    magnitude = np.clip(np.hypot(gradient_x, gradient_y), 0, 255)
    return normalized_histogram(magnitude)


def cosine(left, right):
    import numpy as np

    left = np.asarray(left, dtype=np.float64)
    right = np.asarray(right, dtype=np.float64)
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denominator == 0:
        return 1.0 if np.array_equal(left, right) else 0.0
    return float(np.clip(np.dot(left, right) / denominator, -1.0, 1.0))


def histogram_intersection(left, right):
    import numpy as np

    return float(np.clip(np.minimum(left, right).sum() / 3.0, 0.0, 1.0))


def model_config(value):
    if not isinstance(value, dict) or not isinstance(value.get("modelId"), str) or not value["modelId"]:
        raise ValueError("explicit_model_required")
    return value


def load_model(config):
    import torch
    import transformers
    from transformers import AutoModel, AutoProcessor

    requested_device = config.get("device", "auto")
    device = "cuda" if requested_device == "auto" and torch.cuda.is_available() else requested_device
    if device == "auto":
        device = "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("cuda_not_available")
    options = {
        "revision": config.get("revision"),
        "local_files_only": not bool(config.get("allowDownload", False)),
        "trust_remote_code": False,
    }
    options = {key: value for key, value in options.items() if value is not None}
    processor = AutoProcessor.from_pretrained(config["modelId"], **options)
    model = AutoModel.from_pretrained(config["modelId"], **options).to(device).eval()
    if not hasattr(model, "get_image_features"):
        raise RuntimeError("model_does_not_expose_image_features")
    return model, processor, torch, transformers, device


def probe(config_value):
    try:
        config = model_config(config_value)
        model, _, torch, transformers, device = load_model(config)
        del model
        return {
            "available": True,
            "evaluatorId": EVALUATOR_ID,
            "evaluatorVersion": EVALUATOR_VERSION,
            "modelId": config["modelId"],
            "modelRevision": config.get("revision"),
            "measurement": "representation_similarity",
            "device": device,
            "torchVersion": torch.__version__,
            "transformersVersion": transformers.__version__,
        }
    except ModuleNotFoundError as exc:
        return {"available": False, "reason": "evaluator_dependency_not_installed", "detail": str(exc)}
    except OSError as exc:
        reason = "model_load_failed" if config_value and config_value.get("allowDownload") else "model_not_available_locally"
        return {"available": False, "reason": reason, "detail": str(exc)}
    except Exception as exc:
        return {"available": False, "reason": str(exc)}


def embedding_features(paths, model, processor, torch, device):
    from PIL import Image

    images = []
    try:
        for path in paths:
            images.append(Image.open(path).convert("RGB"))
        inputs = processor(images=images, return_tensors="pt")
        pixel_values = inputs["pixel_values"].to(device)
        with torch.no_grad():
            features = model.get_image_features(pixel_values=pixel_values)
            features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
        return features.detach().cpu().numpy()
    finally:
        for image in images:
            image.close()


def evaluate(request):
    import numpy as np

    config = model_config(request.get("model"))
    references = request.get("references")
    if not isinstance(references, list):
        raise ValueError("references_required")
    by_role = {item["role"]: item["path"] for item in references}
    for role in ("line_reference", "color_reference", "negative_reference"):
        if role not in by_role:
            raise ValueError(f"missing_reference_role:{role}")

    model, processor, torch, transformers, device = load_model(config)
    ordered_roles = [item["role"] for item in references]
    paths = [request["sourcePath"], request["candidatePath"], *[item["path"] for item in references]]
    features = embedding_features(paths, model, processor, torch, device)
    candidate_feature = features[1]
    reference_features = {role: features[index + 2] for index, role in enumerate(ordered_roles)}
    identity_score = cosine(features[0], candidate_feature)
    positive_roles = [role for role in ordered_roles if role != "negative_reference"]
    positive_similarities = [cosine(candidate_feature, reference_features[role]) for role in positive_roles]
    negative_similarity = max(
        cosine(candidate_feature, reference_features[role])
        for role in ordered_roles
        if role == "negative_reference"
    )
    line_alignment = cosine(
        line_histogram(request["candidatePath"]),
        line_histogram(by_role["line_reference"]),
    )
    color_alignment = histogram_intersection(
        color_histogram(request["candidatePath"]),
        color_histogram(by_role["color_reference"]),
    )
    candidate_artifact = artifact(request["candidatePath"])
    artifact_quality = 1.0 if candidate_artifact["nonEmptyPixels"] > 0 else 0.0
    return {
        "artifact": candidate_artifact,
        "evaluator": {
            "evaluatorId": EVALUATOR_ID,
            "evaluatorVersion": EVALUATOR_VERSION,
            "modelId": config["modelId"],
            "modelRevision": config.get("revision"),
            "modelLicense": config.get("license"),
            "measurement": "representation_similarity",
            "device": device,
            "torchVersion": torch.__version__,
            "transformersVersion": transformers.__version__,
            "limits": "Embedding similarity is not exact character identity proof.",
        },
        "scores": {
            "identity": identity_score,
            "lineAlignment": line_alignment,
            "colorAlignment": color_alignment,
            "styleAlignment": float(np.mean(positive_similarities)),
            "artifactQuality": artifact_quality,
            "negativeReferenceSimilarity": negative_similarity,
        },
        "thresholds": request.get("thresholds"),
        "warnings": [],
    }


def main(request):
    action = request.get("action")
    if action == "probe":
        return probe(request.get("model"))
    if action == "evaluate":
        return evaluate(request)
    raise ValueError("unsupported_action")


try:
    payload = json.load(sys.stdin)
    print(json.dumps({"ok": True, "result": main(payload)}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
    sys.exit(1)
