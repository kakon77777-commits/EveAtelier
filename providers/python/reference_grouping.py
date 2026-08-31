def group_reference_records(references, feature_rows):
    if len(references) != len(feature_rows):
        raise ValueError("reference_feature_count_mismatch")
    groups = {}
    for reference, feature in zip(references, feature_rows):
        role = reference.get("role")
        path = reference.get("path")
        if not isinstance(role, str) or not role:
            raise ValueError("reference_role_required")
        if not isinstance(path, str) or not path:
            raise ValueError("reference_path_required")
        groups.setdefault(role, []).append({"path": path, "feature": feature})
    return groups
