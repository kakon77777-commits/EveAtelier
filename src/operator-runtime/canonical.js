import { createHash } from 'node:crypto';
import { isCanonicalJsonValue } from './json-values.js';

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      key => `${JSON.stringify(key)}:${canonicalize(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJson(value) {
  if (!isCanonicalJsonValue(value)) throw new TypeError('non_canonical_json_value');
  return canonicalize(value);
}

export function digestDefinition(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
