#!/usr/bin/env python3
import hashlib
import json
import sys
from pathlib import Path

try:
    from .image_feature_output import normalized_image_features
    from .reference_grouping import group_reference_records
except ImportError:
    from image_feature_output import normalized_image_features
    from reference_grouping import group_reference_records

EVALUATOR_ID = "evaluator:clip-hybrid"
EVALUATOR_VERSION = "0.1.0"


def normalized_number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label}_must_be_number")
    result = float(value)
    if result < 0.0 or result > 1.0:
        raise ValueError(f"{label}_must_be_normalized")
    return result


def build_localized_repair_mask(request):
    from PIL import Image, ImageDraw, ImageFilter

    width = request.get("width")
    height = request.get("height")
    if isinstance(width, bool) or not isinstance(width, int) or width <= 0:
        raise ValueError("mask_width_invalid")
    if isinstance(height, bool) or not isinstance(height, int) or height <= 0:
        raise ValueError("mask_height_invalid")
    regions = request.get("regions")
    if not isinstance(regions, list) or not regions:
        raise ValueError("repair_regions_required")
    feather_radius = request.get("featherRadius", 0)
    if isinstance(feather_radius, bool) or not isinstance(feather_radius, (int, float)) or feather_radius < 0:
        raise ValueError("feather_radius_invalid")
    output_path = request.get("outputPath")
    if not isinstance(output_path, str) or not output_path:
        raise ValueError("mask_output_path_required")

    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for index, region in enumerate(regions):
        if not isinstance(region, dict):
            raise ValueError(f"repair_region_invalid:{index}")
        kind = region.get("kind")
        if kind in ("rectangle", "ellipse"):
            x = normalized_number(region.get("x"), f"region_{index}_x")
            y = normalized_number(region.get("y"), f"region_{index}_y")
            region_width = normalized_number(region.get("width"), f"region_{index}_width")
            region_height = normalized_number(region.get("height"), f"region_{index}_height")
            if region_width <= 0 or region_height <= 0 or x + region_width > 1 or y + region_height > 1:
                raise ValueError(f"repair_region_bounds_invalid:{index}")
            box = (
                round(x * width),
                round(y * height),
                round((x + region_width) * width) - 1,
                round((y + region_height) * height) - 1,
            )
            if kind == "rectangle":
                draw.rectangle(box, fill=255)
            else:
                draw.ellipse(box, fill=255)
        elif kind == "polygon":
            points = region.get("points")
            if not isinstance(points, list) or len(points) < 3:
                raise ValueError(f"repair_polygon_invalid:{index}")
            normalized_points = []
            for point_index, point in enumerate(points):
                if not isinstance(point, list) or len(point) != 2:
                    raise ValueError(f"repair_polygon_point_invalid:{index}:{point_index}")
                x = normalized_number(point[0], f"region_{index}_point_{point_index}_x")
                y = normalized_number(point[1], f"region_{index}_point_{point_index}_y")
                normalized_points.append((round(x * (width - 1)), round(y * (height - 1))))
            draw.polygon(normalized_points, fill=255)
        else:
            raise ValueError(f"repair_region_kind_invalid:{kind}")

    if feather_radius > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=float(feather_radius)))
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    mask.save(target, format="PNG")
    payload = target.read_bytes()
    non_zero = sum(mask.histogram()[1:])
    return {
        "width": width,
        "height": height,
        "nonZeroPixels": non_zero,
        "maskCoverage": non_zero / float(width * height),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
    }


def evaluate_localized_repair(request):
    from PIL import Image
    import numpy as np

    paths = {}
    for key in ("parentPath", "candidatePath", "maskPath"):
        value = request.get(key)
        if not isinstance(value, str) or not value:
            raise ValueError(f"{key}_required")
        paths[key] = Path(value)

    with Image.open(paths["parentPath"]) as image:
        parent = np.asarray(image.convert("RGBA"), dtype=np.int16)
    with Image.open(paths["candidatePath"]) as image:
        candidate = np.asarray(image.convert("RGBA"), dtype=np.int16)
    with Image.open(paths["maskPath"]) as image:
        mask = np.asarray(image.convert("L"), dtype=np.uint8)

    same_dimensions = parent.shape == candidate.shape and parent.shape[:2] == mask.shape
    result = {
        "sameDimensions": bool(same_dimensions),
        "parentSha256": hashlib.sha256(paths["parentPath"].read_bytes()).hexdigest(),
        "candidateSha256": hashlib.sha256(paths["candidatePath"].read_bytes()).hexdigest(),
        "maskSha256": hashlib.sha256(paths["maskPath"].read_bytes()).hexdigest(),
    }
    if not same_dimensions:
        return result

    inside = mask > 0
    outside = ~inside
    mask_pixels = int(inside.sum())
    if mask_pixels == 0:
        raise ValueError("localized_repair_mask_empty")
    delta = np.abs(candidate - parent)
    changed = np.any(delta > 0, axis=2)
    total_pixels = int(mask.size)
    result.update({
        "totalPixels": total_pixels,
        "maskPixels": mask_pixels,
        "maskCoverage": mask_pixels / float(total_pixels),
        "insideChangedPixels": int((changed & inside).sum()),
        "outsideChangedPixels": int((changed & outside).sum()),
        "insideMeanAbsoluteError": float(delta[inside].mean()),
        "outsideMeanAbsoluteError": float(delta[outside].mean()) if outside.any() else 0.0,
        "outsideMaxAbsoluteDelta": int(delta[outside].max()) if outside.any() else 0,
    })
    return result


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
            features = normalized_image_features(features)
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
    by_role = group_reference_records(references, [None] * len(references))
    for role in ("line_reference", "color_reference", "negative_reference"):
        if role not in by_role:
            raise ValueError(f"missing_reference_role:{role}")

    model, processor, torch, transformers, device = load_model(config)
    paths = [request["sourcePath"], request["candidatePath"], *[item["path"] for item in references]]
    features = embedding_features(paths, model, processor, torch, device)
    candidate_feature = features[1]
    reference_groups = group_reference_records(references, features[2:])
    identity_score = cosine(features[0], candidate_feature)
    positive_similarities = [
        cosine(candidate_feature, item["feature"])
        for role, items in reference_groups.items()
        if role != "negative_reference"
        for item in items
    ]
    negative_similarity = max(
        cosine(candidate_feature, item["feature"])
        for item in reference_groups["negative_reference"]
    )
    line_alignment = cosine(
        line_histogram(request["candidatePath"]),
        line_histogram(by_role["line_reference"][0]["path"]),
    )
    color_alignment = histogram_intersection(
        color_histogram(request["candidatePath"]),
        color_histogram(by_role["color_reference"][0]["path"]),
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
    if action == "build_localized_repair_mask":
        return build_localized_repair_mask(request)
    if action == "evaluate_localized_repair":
        return evaluate_localized_repair(request)
    raise ValueError("unsupported_action")


try:
    payload = json.load(sys.stdin)
    print(json.dumps({"ok": True, "result": main(payload)}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
    sys.exit(1)
