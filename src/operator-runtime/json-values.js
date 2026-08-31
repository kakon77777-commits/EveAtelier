function plainObjectEntries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null;
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function denseArrayValues(value) {
  if (!Array.isArray(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return null;
  const values = new Array(value.length);
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)) return null;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= value.length) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null;
    values[index] = descriptor.value;
  }
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.hasOwn(values, index)) return null;
  }
  return values;
}

export function isPlainJsonObject(value) {
  return plainObjectEntries(value) !== null;
}

export function isDenseJsonArray(value) {
  return denseArrayValues(value) !== null;
}

export function normalizeCanonicalJsonValue(value) {
  const stack = new Set();
  function normalize(candidate) {
    if (candidate === null
        || typeof candidate === 'string'
        || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number') {
      if (Number.isFinite(candidate) && !Object.is(candidate, -0)) return candidate;
      throw new TypeError('non_canonical_json_value');
    }
    if (typeof candidate !== 'object' || stack.has(candidate)) {
      throw new TypeError('non_canonical_json_value');
    }
    stack.add(candidate);
    try {
      const arrayValues = denseArrayValues(candidate);
      if (arrayValues !== null) return arrayValues.map(normalize);
      const entries = plainObjectEntries(candidate);
      if (entries === null) throw new TypeError('non_canonical_json_value');
      const result = Object.create(null);
      for (const [key, entryValue] of entries) result[key] = normalize(entryValue);
      return result;
    } finally {
      stack.delete(candidate);
    }
  }
  return normalize(value);
}

export function isCanonicalJsonValue(value) {
  try {
    normalizeCanonicalJsonValue(value);
    return true;
  } catch {
    return false;
  }
}
