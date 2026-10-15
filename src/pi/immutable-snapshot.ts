// Only snapshots made here are shareable: Object.freeze alone is shallow and
// cannot establish ownership/isolation of arbitrary caller-provided objects.
const immutable = new WeakSet<object>();

/** Detached, recursively frozen data; immutable strings and owned subtrees are shared. */
export function immutableSnapshot<Data>(data: Data): Readonly<Data> {
  const seen = new WeakMap<object, object>();
  const copy = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') throw new Error('Uncloneable card data');
      return value;
    }
    if (immutable.has(value)) return value;
    const prior = seen.get(value); if (prior) return prior;
    const plain = Object.prototype.toString.call(value) === '[object Object]';
    if (!Array.isArray(value) && !plain) {
      // Compatibility for non-JSON callers; do not cache mutable built-in internals.
      const cloned = typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
      Object.freeze(cloned); return cloned;
    }
    const cloned: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
    seen.set(value, cloned);
    for (const key of Object.keys(value)) Object.defineProperty(cloned, key, {
      value: copy((value as Record<string, unknown>)[key]), enumerable: true, configurable: true, writable: true,
    });
    Object.freeze(cloned);
    if (Object.values(cloned).every(child => !child || typeof child !== 'object' || immutable.has(child))) immutable.add(cloned);
    return cloned;
  };
  return copy(data) as Readonly<Data>;
}
