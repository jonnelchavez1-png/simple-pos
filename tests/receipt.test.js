import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../web/src/store.js';
import { buildSettings } from '../web/src/presets.js';
import { recordSale, voidSale } from '../web/src/services.js';
import { receiptText } from '../web/src/receipt.js';

const settings = { ...buildSettings({ businessName: 'Corner Shop', taxRate: 10 }), receipt: { header: '123 Main St', footer: 'Thanks!', prefix: 'R' } };

test('receipt shows lines, discount, tax, total and change', async () => {
  const store = memoryStore();
  const sale = await recordSale(store, settings, {
    cart: {
      lines: [
        { name: 'Coffee', unitPrice: 300, qty: 2, taxId: 'std' },
        { name: 'A very long product name that will not fit on one line', unitPrice: 1000, qty: 1, taxId: 'std', discount: { type: 'percent', value: 10 } },
      ],
    },
    payment: { method: 'Cash', tendered: 5000 },
    now: new Date('2026-10-23T09:05:00'),
  });
  const text = receiptText(sale, settings);
  assert.match(text, /Corner Shop/);
  assert.match(text, /123 Main St/);
  assert.match(text, /R261023-0001/);
  assert.match(text, /2026-10-23 09:05/);
  assert.match(text, /2 x Coffee\s+\$6\.00/);
  assert.match(text, /@ \$3\.00/);
  assert.match(text, /Item discounts\s+-\$1\.00/);
  assert.match(text, /Standard tax 10%\s+\$1\.50/);
  assert.match(text, /TOTAL\s+\$16\.50/);
  assert.match(text, /Change\s+\$33\.50/);
  assert.match(text, /Thanks!/);
  for (const line of text.split('\n')) assert.ok(line.length <= 32, `too wide: "${line}"`);
});

test('inclusive tax is shown as included', async () => {
  const s = { ...settings, taxMode: 'inclusive' };
  const sale = await recordSale(memoryStore(), s, { cart: { lines: [{ name: 'A', unitPrice: 1100, qty: 1, taxId: 'std' }] }, payment: { method: 'Card' } });
  const text = receiptText(sale, s);
  assert.match(text, /Incl\. Standard tax 10%\s+\$1\.00/);
  assert.match(text, /TOTAL\s+\$11\.00/);
  assert.doesNotMatch(text, /Change/);
});

test('voided sales are marked', async () => {
  const store = memoryStore();
  const sale = await recordSale(store, settings, { cart: { lines: [{ name: 'A', unitPrice: 100, qty: 1 }] }, payment: { method: 'Cash' } });
  const voided = await voidSale(store, sale.id);
  assert.match(receiptText(voided, settings), /VOIDED/);
});

test('a receipt keeps the currency and tax mode it was sold with', async () => {
  const sale = await recordSale(memoryStore(), settings, { cart: { lines: [{ name: 'A', unitPrice: 500, qty: 1 }] }, payment: { method: 'Cash' } });
  const later = { ...settings, currency: 'EUR', taxMode: 'inclusive' };
  assert.match(receiptText(sale, later), /\$5\.00/);
});
