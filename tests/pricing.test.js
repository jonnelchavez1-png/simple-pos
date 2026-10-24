import test from 'node:test';
import assert from 'node:assert/strict';
import { priceCart, discountAmount, validateCart } from '../web/src/pricing.js';

const rates = [
  { id: 'std', name: 'Standard', rate: 10 },
  { id: 'vat12', name: 'VAT', rate: 12 },
  { id: 'odd', name: 'Odd', rate: 7.5 },
];

test('tax added on top (exclusive)', () => {
  const r = priceCart({ lines: [{ name: 'A', unitPrice: 1000, qty: 2, taxId: 'std' }] }, { taxMode: 'exclusive', taxRates: rates });
  assert.equal(r.totals.subtotal, 2000);
  assert.equal(r.totals.tax, 200);
  assert.equal(r.totals.net, 2000);
  assert.equal(r.totals.total, 2200);
});

test('tax already included (inclusive)', () => {
  const r = priceCart({ lines: [{ name: 'A', unitPrice: 1120, qty: 1, taxId: 'vat12' }] }, { taxMode: 'inclusive', taxRates: rates });
  assert.equal(r.totals.tax, 120);
  assert.equal(r.totals.net, 1000);
  assert.equal(r.totals.total, 1120);
});

test('no tax rate means no tax', () => {
  const r = priceCart({ lines: [{ name: 'A', unitPrice: 500, qty: 3 }] }, { taxMode: 'exclusive', taxRates: rates });
  assert.equal(r.totals.tax, 0);
  assert.equal(r.totals.total, 1500);
});

test('line discount in percent reduces the taxable amount', () => {
  const r = priceCart(
    { lines: [{ name: 'A', unitPrice: 1000, qty: 2, taxId: 'std', discount: { type: 'percent', value: 10 } }] },
    { taxMode: 'exclusive', taxRates: rates },
  );
  assert.equal(r.lines[0].lineDiscount, 200);
  assert.equal(r.totals.tax, 180);
  assert.equal(r.totals.total, 1980);
  assert.equal(r.totals.discount, 200);
});

test('fixed order discount is shared across lines and sums exactly', () => {
  const r = priceCart(
    { lines: [{ name: 'A', unitPrice: 1000, qty: 1 }, { name: 'B', unitPrice: 2000, qty: 1 }], orderDiscount: { type: 'fixed', value: 100 } },
    { taxMode: 'exclusive', taxRates: rates },
  );
  assert.deepEqual(r.lines.map((l) => l.orderShare), [33, 67]);
  assert.equal(r.totals.orderDiscount, 100);
  assert.equal(r.totals.total, 2900);
});

test('order discount reduces tax on every line', () => {
  const r = priceCart(
    { lines: [{ name: 'A', unitPrice: 1000, qty: 1, taxId: 'std' }, { name: 'B', unitPrice: 1000, qty: 1, taxId: 'std' }], orderDiscount: { type: 'percent', value: 50 } },
    { taxMode: 'exclusive', taxRates: rates },
  );
  assert.equal(r.totals.net, 1000);
  assert.equal(r.totals.tax, 100);
  assert.equal(r.totals.total, 1100);
});

test('discounts never exceed the amount and percent is capped at 100', () => {
  assert.equal(discountAmount(500, { type: 'fixed', value: 900 }), 500);
  assert.equal(discountAmount(500, { type: 'percent', value: 250 }), 500);
  assert.equal(discountAmount(500, { type: 'percent', value: 0 }), 0);
  assert.equal(discountAmount(500, null), 0);
  const r = priceCart({ lines: [{ name: 'A', unitPrice: 800, qty: 1, taxId: 'std' }], orderDiscount: { type: 'percent', value: 100 } }, { taxRates: rates });
  assert.equal(r.totals.total, 0);
});

test('fractional quantities (weight) round to the nearest unit, half up', () => {
  const r = priceCart({ lines: [{ name: 'Rice per kg', unitPrice: 1999, qty: 0.5 }] }, {});
  assert.equal(r.lines[0].gross, 1000); // 999.5 rounds up
  const r2 = priceCart({ lines: [{ name: 'Fabric', unitPrice: 1000, qty: 1.25 }] }, {});
  assert.equal(r2.totals.total, 1250);
});

test('tax rounds half up per line', () => {
  const r = priceCart({ lines: [{ name: 'A', unitPrice: 1010, qty: 1, taxId: 'odd' }] }, { taxMode: 'exclusive', taxRates: rates });
  assert.equal(r.totals.tax, 76); // 75.75
});

test('tax breakdown groups by rate', () => {
  const r = priceCart(
    { lines: [{ name: 'A', unitPrice: 1000, qty: 1, taxId: 'std' }, { name: 'B', unitPrice: 500, qty: 1 }, { name: 'C', unitPrice: 2000, qty: 1, taxId: 'std' }] },
    { taxMode: 'exclusive', taxRates: rates },
  );
  const std = r.totals.taxBreakdown.find((b) => b.id === 'std');
  const none = r.totals.taxBreakdown.find((b) => b.id === 'none');
  assert.deepEqual([std.base, std.tax], [3000, 300]);
  assert.deepEqual([none.base, none.tax], [500, 0]);
});

test('invalid carts are rejected', () => {
  assert.ok(validateCart({ lines: [] }).length > 0);
  assert.ok(validateCart({ lines: [{ unitPrice: -1, qty: 1 }] }).length > 0);
  assert.ok(validateCart({ lines: [{ unitPrice: 100, qty: 0 }] }).length > 0);
  assert.throws(() => priceCart({ lines: [] }, {}));
});

test('invariants hold across many pseudo-random carts', () => {
  let seed = 12345;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const ids = [undefined, 'std', 'vat12', 'odd'];
  for (let i = 0; i < 400; i++) {
    const lines = Array.from({ length: 1 + rnd(5) }, () => ({
      name: 'x',
      unitPrice: rnd(100000),
      qty: 1 + rnd(9) + rnd(4) * 0.25,
      taxId: ids[rnd(4)],
      discount: rnd(3) === 0 ? { type: rnd(2) ? 'percent' : 'fixed', value: rnd(2) ? rnd(100) : rnd(5000) } : undefined,
    }));
    const orderDiscount = rnd(3) === 0 ? { type: 'percent', value: rnd(60) } : undefined;
    for (const taxMode of ['exclusive', 'inclusive']) {
      const { lines: out, totals } = priceCart({ lines, orderDiscount }, { taxMode, taxRates: rates });
      assert.equal(out.reduce((s, l) => s + l.total, 0), totals.total);
      assert.equal(out.reduce((s, l) => s + l.orderShare, 0), totals.orderDiscount);
      assert.equal(totals.net + totals.tax, totals.total);
      assert.equal(totals.subtotal - totals.discount + (taxMode === 'exclusive' ? totals.tax : 0), totals.total);
      assert.ok(totals.total >= 0 && out.every((l) => l.net >= 0 && l.tax >= 0));
    }
  }
});
