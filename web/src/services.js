// Business operations: record a sale, void it, add an expense, back up and restore.
// These sit between the screens and the store, and hold the rules (validation, numbering).

import { priceCart, validateCart } from './pricing.js';
import { toDateStr } from './reports.js';
import { isDateStr, uid } from './util.js';
import { SCHEMA_VERSION } from './presets.js';

export const nowIso = (now = new Date()) => now.toISOString();

export async function getSettings(store) {
  return (await store.get('kv', 'settings'))?.value ?? null;
}
export async function saveSettings(store, settings) {
  await store.put('kv', { key: 'settings', value: settings });
  return settings;
}

async function nextReceiptNo(store, prefix, dateStr) {
  const key = `receipt:${dateStr}`;
  const n = ((await store.get('kv', key))?.value ?? 0) + 1;
  await store.put('kv', { key, value: n });
  return `${prefix}${dateStr.replace(/-/g, '').slice(2)}-${String(n).padStart(4, '0')}`;
}

const keepLine = (l) => ({
  productId: l.productId ?? null,
  name: l.name,
  unitPrice: l.unitPrice,
  qty: Number(l.qty),
  taxId: l.taxId ?? null,
  discount: l.discount ?? null,
  gross: l.gross,
  lineDiscount: l.lineDiscount,
  orderShare: l.orderShare,
  net: l.net,
  tax: l.tax,
  total: l.total,
});

/**
 * Price the cart, check the payment and save the sale.
 * `payment` = { method, tendered? } where tendered is the cash handed over (minor units).
 */
export async function recordSale(store, settings, { cart, payment, note = '', now = new Date() }) {
  const problems = validateCart(cart);
  if (problems.length) throw new Error(problems.join(' '));
  const priced = priceCart(cart, settings);
  const total = priced.totals.total;

  const method = payment?.method || settings.paymentMethods[0] || 'Cash';
  let tendered = null;
  let change = 0;
  if (payment?.tendered != null && payment.tendered !== '') {
    tendered = Number(payment.tendered);
    if (!Number.isInteger(tendered) || tendered < total) throw new Error('The amount received is less than the total.');
    change = tendered - total;
  }

  const date = toDateStr(now);
  const sale = {
    id: uid(),
    receiptNo: await nextReceiptNo(store, settings.receipt?.prefix ?? 'R', date),
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    date,
    status: 'completed',
    currency: settings.currency,
    taxMode: settings.taxMode,
    lines: priced.lines.map(keepLine),
    orderDiscount: cart.orderDiscount ?? null,
    totals: priced.totals,
    payment: { method, tendered, change },
    note: String(note || '').slice(0, 300),
    synced: 0,
  };
  await store.put('sales', sale);
  return sale;
}

export async function voidSale(store, id, reason = '', now = new Date()) {
  const sale = await store.get('sales', id);
  if (!sale) throw new Error('Sale not found.');
  if (sale.status === 'voided') return sale;
  const updated = { ...sale, status: 'voided', voidReason: String(reason).slice(0, 200), voidedAt: nowIso(now), updatedAt: nowIso(now), synced: 0 };
  await store.put('sales', updated);
  return updated;
}

export async function addExpense(store, e, now = new Date()) {
  const amount = Number(e.amount);
  const taxAmount = Number(e.taxAmount || 0);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
  if (!Number.isInteger(taxAmount) || taxAmount < 0 || taxAmount > amount) throw new Error('Tax paid cannot be more than the amount.');
  const date = e.date || toDateStr(now);
  if (!isDateStr(date)) throw new Error('Enter a valid date.');
  const expense = {
    id: e.id || uid(),
    date,
    amount,
    taxAmount,
    category: String(e.category || 'Other').slice(0, 80),
    vendor: String(e.vendor || '').slice(0, 120),
    note: String(e.note || '').slice(0, 300),
    paymentMethod: e.paymentMethod || '',
    source: e.source || 'manual',
    status: 'active',
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    synced: e.synced ?? 0,
  };
  await store.put('expenses', expense);
  return expense;
}

export async function deleteExpense(store, id, now = new Date()) {
  const e = await store.get('expenses', id);
  if (!e) throw new Error('Expense not found.');
  const updated = { ...e, status: 'deleted', updatedAt: nowIso(now), synced: 0 };
  await store.put('expenses', updated);
  return updated;
}

export async function saveProduct(store, p) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('Enter a name.');
  if (!Number.isInteger(p.price) || p.price < 0) throw new Error('Enter a price.');
  const product = { id: p.id || uid(), name, price: p.price, category: String(p.category || '').trim(), taxId: p.taxId || 'none', active: p.active !== false };
  await store.put('products', product);
  return product;
}

export async function exportBackup(store, businessName = '') {
  const [sales, expenses, products, settings] = await Promise.all([
    store.getAll('sales'),
    store.getAll('expenses'),
    store.getAll('products'),
    getSettings(store),
  ]);
  return { app: 'simple-pos', schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), businessName, data: { settings, products, sales, expenses } };
}

/** Restore a backup file. Existing records with the same id are overwritten; nothing else is deleted. */
export async function importBackup(store, backup) {
  if (!backup || backup.app !== 'simple-pos' || !backup.data) throw new Error('This is not a backup file from this app.');
  if (backup.schemaVersion > SCHEMA_VERSION) throw new Error('This backup is from a newer version of the app. Update the app first.');
  const { settings, products = [], sales = [], expenses = [] } = backup.data;
  for (const p of products) await store.put('products', p);
  for (const s of sales) await store.put('sales', s);
  for (const e of expenses) await store.put('expenses', e);
  if (settings) await saveSettings(store, settings);
  return { products: products.length, sales: sales.length, expenses: expenses.length };
}
