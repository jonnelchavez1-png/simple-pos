import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, createProfiles } from '../web/src/store.js';
import { buildSettings, sampleProducts, PRESETS } from '../web/src/presets.js';
import { recordSale, voidSale, addExpense, deleteExpense, saveProduct, exportBackup, importBackup, saveSettings, getSettings } from '../web/src/services.js';
import { summarize } from '../web/src/reports.js';

const settings = buildSettings({ businessName: 'Test Cafe', businessType: 'food', currency: 'USD', taxRate: 10, taxMode: 'exclusive' });
const cartOf = (...lines) => ({ lines });
const noon = new Date('2026-10-23T12:00:00');

test('presets build usable settings for every business type', () => {
  for (const type of Object.keys(PRESETS)) {
    const s = buildSettings({ businessName: 'X', businessType: type, currency: 'PHP', taxRate: 12 });
    assert.ok(s.paymentMethods.length && s.expenseCategories.length && s.labels.item);
    assert.deepEqual(s.taxRates.map((t) => t.id), ['none', 'std']);
    const products = sampleProducts(type, 'PHP', true);
    assert.ok(products.length > 0 && products.every((p) => Number.isInteger(p.price) && p.taxId === 'std'));
  }
});

test('no tax rate means only the "No tax" option and not tax-registered', () => {
  const s = buildSettings({ businessName: 'X', taxRate: 0 });
  assert.deepEqual(s.taxRates.map((t) => t.id), ['none']);
  assert.equal(s.taxRegistered, false);
});

test('unknown business type falls back to general', () => {
  assert.equal(buildSettings({ businessName: 'X', businessType: 'nope' }).businessType, 'general');
});

test('recordSale prices, numbers and stores the sale', async () => {
  const store = memoryStore();
  const sale = await recordSale(store, settings, {
    cart: cartOf({ name: 'Coffee', unitPrice: 300, qty: 2, taxId: 'std' }),
    payment: { method: 'Cash', tendered: 1000 },
    now: noon,
  });
  assert.equal(sale.totals.total, 660);
  assert.equal(sale.totals.tax, 60);
  assert.equal(sale.payment.change, 340);
  assert.equal(sale.receiptNo, 'R261023-0001');
  assert.equal(sale.date, '2026-10-23');
  assert.equal(sale.synced, 0);
  assert.equal((await store.getAll('sales')).length, 1);
});

test('receipt numbers count up per day and restart each day', async () => {
  const store = memoryStore();
  const mk = (now) => recordSale(store, settings, { cart: cartOf({ name: 'A', unitPrice: 100, qty: 1 }), payment: { method: 'Cash' }, now });
  assert.equal((await mk(noon)).receiptNo, 'R261023-0001');
  assert.equal((await mk(noon)).receiptNo, 'R261023-0002');
  assert.equal((await mk(new Date('2026-10-24T09:00:00'))).receiptNo, 'R261024-0001');
});

test('recordSale refuses short payment and empty carts', async () => {
  const store = memoryStore();
  await assert.rejects(() => recordSale(store, settings, { cart: cartOf({ name: 'A', unitPrice: 500, qty: 1 }), payment: { method: 'Cash', tendered: 100 } }), /less than the total/);
  await assert.rejects(() => recordSale(store, settings, { cart: { lines: [] }, payment: { method: 'Cash' } }), /empty/);
  assert.equal((await store.getAll('sales')).length, 0);
});

test('voiding keeps the record, flags it for sync and removes it from reports', async () => {
  const store = memoryStore();
  const sale = await recordSale(store, settings, { cart: cartOf({ name: 'A', unitPrice: 500, qty: 1 }), payment: { method: 'Cash' }, now: noon });
  await store.put('sales', { ...sale, synced: 1 });
  const voided = await voidSale(store, sale.id, 'wrong order', noon);
  assert.equal(voided.status, 'voided');
  assert.equal(voided.synced, 0);
  const s = summarize(await store.getAll('sales'), [], { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(s.saleCount, 0);
  assert.equal(s.voidedCount, 1);
});

test('expenses validate and soft-delete', async () => {
  const store = memoryStore();
  await assert.rejects(() => addExpense(store, { amount: 0 }), /greater than zero/);
  await assert.rejects(() => addExpense(store, { amount: 100, taxAmount: 500 }), /Tax paid/);
  await assert.rejects(() => addExpense(store, { amount: 100, date: 'yesterday' }), /valid date/);
  const e = await addExpense(store, { amount: 1000, taxAmount: 100, category: 'Rent', date: '2026-10-05' });
  assert.equal(e.status, 'active');
  const del = await deleteExpense(store, e.id);
  assert.equal(del.status, 'deleted');
  assert.equal(del.synced, 0);
  assert.equal(summarize([], await store.getAll('expenses'), { from: '2026-10-01', to: '2026-10-31' }).expensesTotal, 0);
});

test('products are validated', async () => {
  const store = memoryStore();
  await assert.rejects(() => saveProduct(store, { name: ' ', price: 100 }), /name/);
  await assert.rejects(() => saveProduct(store, { name: 'A', price: 1.5 }), /price/);
  const p = await saveProduct(store, { name: 'A', price: 150 });
  assert.equal(p.taxId, 'none');
  assert.equal((await store.getAll('products')).length, 1);
});

test('backup and restore round-trip', async () => {
  const a = memoryStore();
  await saveSettings(a, settings);
  await saveProduct(a, { name: 'Tea', price: 250 });
  await recordSale(a, settings, { cart: cartOf({ name: 'Tea', unitPrice: 250, qty: 1 }), payment: { method: 'Cash' }, now: noon });
  await addExpense(a, { amount: 500, category: 'Rent', date: '2026-10-01' });
  const backup = JSON.parse(JSON.stringify(await exportBackup(a, 'Test Cafe')));

  const b = memoryStore();
  const counts = await importBackup(b, backup);
  assert.deepEqual(counts, { products: 1, sales: 1, expenses: 1 });
  assert.equal((await getSettings(b)).businessName, 'Test Cafe');
  assert.equal((await b.getAll('sales'))[0].totals.total, 250);
});

test('restore rejects foreign or newer files', async () => {
  const store = memoryStore();
  await assert.rejects(() => importBackup(store, { hello: 1 }), /not a backup/);
  await assert.rejects(() => importBackup(store, { app: 'simple-pos', schemaVersion: 99, data: {} }), /newer version/);
});

test('memory store returns copies, not shared objects', async () => {
  const store = memoryStore();
  await store.put('kv', { key: 'a', value: { n: 1 } });
  const got = await store.get('kv', 'a');
  got.value.n = 2;
  assert.equal((await store.get('kv', 'a')).value.n, 1);
});

test('business profiles: add, switch, rename, remove', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const profiles = createProfiles(storage);
  assert.equal(profiles.active(), null);
  const a = profiles.add('Cafe');
  const b = profiles.add('Shop');
  assert.equal(profiles.active().id, b.id);
  profiles.setActive(a.id);
  assert.equal(profiles.active().name, 'Cafe');
  profiles.rename(a.id, 'Cafe 2');
  assert.equal(profiles.list().find((p) => p.id === a.id).name, 'Cafe 2');
  profiles.remove(a.id);
  assert.equal(profiles.list().length, 1);
  assert.equal(profiles.active().id, b.id);
});
