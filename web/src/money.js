// Money helpers. All amounts are INTEGERS in the currency's smallest unit
// (cents, centavos, yen...). Floats are never used for money, so totals always add up.

/** Integer division rounded half away from zero. Exact for any safe integers. */
export function divRound(n, d) {
  const N = BigInt(n);
  const D = BigInt(d);
  if (D <= 0n) throw new RangeError('divRound: divisor must be positive');
  const neg = N < 0n;
  const a = neg ? -N : N;
  const q = (2n * a + D) / (2n * D);
  return Number(neg ? -q : q);
}

/** Split a non-negative integer `total` in proportion to `weights` (largest remainder). Sum is exact. */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !total) return weights.map(() => 0);
  const T = BigInt(total);
  const S = BigInt(sum);
  const shares = weights.map((w) => (T * BigInt(w)) / S);
  const rems = weights.map((w, i) => ({ i, r: T * BigInt(w) - shares[i] * S }));
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  let left = Number(T - shares.reduce((a, b) => a + b, 0n));
  for (let k = 0; left > 0 && k < rems.length; k++, left--) shares[rems[k].i] += 1n;
  return shares.map(Number);
}

export function currencyDecimals(currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

/** Format minor units for display, e.g. 123456 -> "$1,234.56". */
export function formatMoney(minor, { currency = 'USD', locale } = {}) {
  const decimals = currencyDecimals(currency);
  const value = minor / 10 ** decimals;
  try {
    return new Intl.NumberFormat(locale || undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(decimals)}`;
  }
}

/**
 * Parse what a person types ("12.5", "1,234.50", "12,50") into minor units.
 * Returns null when the text is not a number.
 */
export function parseMoney(input, decimals = 2) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 10 ** decimals) : null;
  let s = String(input ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const neg = s.includes('-');
  s = s.replace(/-/g, '');
  if (!/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decSep = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decSep = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    // One separator followed by exactly 3 digits (e.g. "1,234") is a thousands mark, unless the
    // currency has 3 decimals or the number starts with 0 (e.g. "0.005").
    if (parts.length === 2) {
      const thousands = parts[1].length === 3 && decimals !== 3 && parts[0] !== '' && parts[0] !== '0';
      if (!thousands) decSep = sep;
    }
  }

  let intPart = s;
  let frac = '';
  if (decSep) {
    const i = s.lastIndexOf(decSep);
    intPart = s.slice(0, i);
    frac = s.slice(i + 1);
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;

  let minor = Number(intPart || '0') * 10 ** decimals + Number((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (frac.length > decimals && frac[decimals] >= '5') minor += 1;
  return neg ? -minor : minor;
}

/** Minor units -> plain editable string such as "12.50" (no symbol, no grouping). */
export function toInputValue(minor, decimals = 2) {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  if (decimals === 0) return sign + String(abs);
  const s = String(abs).padStart(decimals + 1, '0');
  return `${sign}${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}
