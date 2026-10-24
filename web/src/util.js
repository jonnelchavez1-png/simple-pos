// Small helpers with no browser dependencies (safe to import in tests).

export function uid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const clone = (v) => JSON.parse(JSON.stringify(v));

export function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Split "a, b, c" into a clean list. */
export function parseList(text) {
  return String(text ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
