// Deterministic JSON serialization for golden output (§12, Appendix B):
// object keys sorted, 2-space indent, trailing newline. Pure & browser-safe.

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Stable, key-sorted, 2-space JSON with a trailing newline. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2) + '\n';
}
