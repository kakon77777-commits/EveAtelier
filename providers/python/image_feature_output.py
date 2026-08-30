def normalized_image_features(value):
    if hasattr(value, "pooler_output"):
        features = value.pooler_output
    elif hasattr(value, "image_embeds"):
        features = value.image_embeds
    else:
        features = value
    if not hasattr(features, "norm"):
        raise TypeError("image_feature_output_not_tensor_like")
    return features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
