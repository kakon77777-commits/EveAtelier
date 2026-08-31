export function isPlainJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every(key => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

export function isDenseJsonArray(value) {
  if (!Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return false;
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)) return false;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= value.length) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

export function isCanonicalJsonValue(value) {
  const stack = new Set();
  function visit(candidate) {
    if (candidate === null
        || typeof candidate === 'string'
        || typeof candidate === 'boolean') return true;
    if (typeof candidate === 'number') {
      return Number.isFinite(candidate) && !Object.is(candidate, -0);
    }
    if (typeof candidate !== 'object') return false;
    if (stack.has(candidate)) return false;
    if (!Array.isArray(candidate) && !isPlainJsonObject(candidate)) return false;
    if (Array.isArray(candidate) && !isDenseJsonArray(candidate)) return false;
    stack.add(candidate);
    const values = Array.isArray(candidate)
      ? candidate
      : Object.keys(candidate).map(key => candidate[key]);
    const valid = values.every(visit);
    stack.delete(candidate);
    return valid;
  }
  return visit(value);
}
