export function valueMatchesSchema(value, schema) {
  if (schema.kind === 'SCALAR') {
    return Number.isFinite(value) && value >= schema.min && value <= schema.max;
  }
  if (schema.kind === 'ENUM') return typeof value === 'string' && schema.values.includes(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === schema.dimensions.length
    && keys.every(key => schema.dimensions.includes(key))
    && Object.values(value).every(item => (
      Number.isFinite(item) && item >= schema.min && item <= schema.max
    ));
}
