// Pricing engine: line discounts, order discounts and tax (added-on or already-included).
// Pure functions only, so it is easy to test and safe to change.
//
// Order of operations (documented so accountants can follow it):
//   1. line gross      = unit price x quantity
//   2. line discount   = percent or fixed amount off that line
//   3. order discount  = percent or fixed amount off the whole order, shared across
//                        lines in proportion to their value (largest remainder, exact)
//   4. tax is worked out on each line AFTER discounts, rounded half up per line
//        exclusive: tax is added on top    (total = base + tax)
//        inclusive: tax is inside the price (total = base, tax = base x r / (100 + r))

import { divRound, allocate } from './money.js';

/** Percent (e.g. 7.5) to basis points (750). */
const toBp = (percent) => Math.round(Number(percent) * 100);

/** Amount taken off `base` by a discount {type:'percent'|'fixed', value}. Percent value is 0-100; fixed is minor units. */
export function discountAmount(base, discount) {
  if (!discount || !(Number(discount.value) > 0) || !(base > 0)) return 0;
  if (discount.type === 'percent') {
    return divRound(base * Math.min(toBp(discount.value), 10000), 10000);
  }
  return Math.min(Math.round(Number(discount.value)), base);
}

export function validateCart(cart) {
  const errors = [];
  if (!cart || !Array.isArray(cart.lines) || cart.lines.length === 0) errors.push('The cart is empty.');
  for (const [i, l] of (cart?.lines ?? []).entries()) {
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) errors.push(`Line ${i + 1}: price must be zero or more.`);
    if (!(Number(l.qty) > 0)) errors.push(`Line ${i + 1}: quantity must be more than zero.`);
  }
  return errors;
}

/**
 * @param cart     { lines: [{ name, unitPrice, qty, taxId?, discount? }], orderDiscount? }
 * @param settings { taxMode: 'exclusive'|'inclusive', taxRates: [{ id, name, rate }] }
 * @returns lines with computed amounts, plus totals and a per-tax-rate breakdown
 */
export function priceCart(cart, { taxMode = 'exclusive', taxRates = [] } = {}) {
  const errors = validateCart(cart);
  if (errors.length) throw new Error(errors.join(' '));

  const rateFor = (id) => taxRates.find((t) => t.id === id) ?? null;

  const staged = cart.lines.map((l) => {
    const qtyMilli = Math.round(Number(l.qty) * 1000); // quantities may have up to 3 decimals (kg, litres...)
    const gross = divRound(l.unitPrice * qtyMilli, 1000);
    const lineDiscount = discountAmount(gross, l.discount);
    return { ...l, gross, lineDiscount, afterLine: gross - lineDiscount };
  });

  const orderBase = staged.reduce((s, l) => s + l.afterLine, 0);
  const orderDiscount = discountAmount(orderBase, cart.orderDiscount);
  const shares = allocate(orderDiscount, staged.map((l) => l.afterLine));

  const breakdown = new Map();
  const lines = staged.map((l, i) => {
    const base = l.afterLine - shares[i];
    const rate = rateFor(l.taxId);
    const bp = rate ? toBp(rate.rate) : 0;
    let tax;
    let net;
    let total;
    if (taxMode === 'inclusive') {
      tax = divRound(base * bp, 10000 + bp);
      net = base - tax;
      total = base;
    } else {
      tax = divRound(base * bp, 10000);
      net = base;
      total = base + tax;
    }
    const key = rate ? rate.id : 'none';
    const row = breakdown.get(key) ?? { id: key, name: rate ? rate.name : 'No tax', rate: rate ? Number(rate.rate) : 0, base: 0, tax: 0 };
    row.base += net;
    row.tax += tax;
    breakdown.set(key, row);
    return { ...l, orderShare: shares[i], net, tax, total };
  });

  const sum = (f) => lines.reduce((s, l) => s + f(l), 0);
  const lineDiscounts = sum((l) => l.lineDiscount);
  return {
    lines,
    totals: {
      subtotal: sum((l) => l.gross),
      lineDiscounts,
      orderDiscount,
      discount: lineDiscounts + orderDiscount,
      net: sum((l) => l.net),
      tax: sum((l) => l.tax),
      total: sum((l) => l.total),
      taxBreakdown: [...breakdown.values()],
    },
  };
}
