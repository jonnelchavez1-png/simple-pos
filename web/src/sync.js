// Google Sheets sync through a small Google Apps Script (see backend/Code.gs).
//
//  push : sends sales and expenses that are still marked synced = 0. The script saves each
//         record by id, so sending the same record twice never creates duplicates.
//  pull : reads the existing receipts sheet (the Telegram bot's data) and imports new rows
//         as expenses, so nothing is typed twice.
//
// Requests use Content-Type text/plain so the browser does not need a CORS preflight,
// which Apps Script cannot answer.

import { currencyDecimals, parseMoney } from './money.js';
import { toDateStr } from './reports.js';
import { isDateStr } from './util.js';

export class SyncError extends Error {}

const BATCH = 25;

async function call(url, payload, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
  } catch {
    throw new SyncError('Could not reach Google. Check the internet connection and the web app link.');
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SyncError('Google did not return data. Check that the script is deployed with access set to "Anyone".');
  }
  if (!data.ok) throw new SyncError(data.error || 'The sync script reported an error.');
  return data;
}

function requireSetup(settings) {
  const { url, token } = settings.sync ?? {};
  if (!url || !token) throw new SyncError('Sync is not set up yet. Add the web app link and secret in Settings.');
  return { url, token };
}

export async function pendingCount(store) {
  return (await store.unsynced('sales')).length + (await store.unsynced('expenses')).length;
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function pushUnsynced(store, settings, { fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const { url, token } = requireSetup(settings);
  const sales = await store.unsynced('sales');
  const expenses = await store.unsynced('expenses');
  const meta = { business: settings.businessName, currency: settings.currency, taxMode: settings.taxMode, decimals: currencyDecimals(settings.currency) };
  const sent = { sales: 0, expenses: 0 };

  const jobs = [
    ...chunks(sales, BATCH).map((c) => ({ store: 'sales', rows: c })),
    ...chunks(expenses, BATCH).map((c) => ({ store: 'expenses', rows: c })),
  ];
  for (const job of jobs) {
    const data = await call(url, { token, action: 'push', ...meta, [job.store]: job.rows }, fetchImpl);
    const saved = new Set(data.saved?.[job.store] ?? []);
    for (const row of job.rows) {
      if (!saved.has(row.id)) continue;
      // Only mark as sent if the record was not edited while the request was in flight.
      const current = await store.get(job.store, row.id);
      if (current && current.updatedAt === row.updatedAt) await store.put(job.store, { ...current, synced: 1 });
      sent[job.store] += 1;
    }
  }
  return sent;
}

function normaliseDate(value) {
  if (isDateStr(value)) return value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : toDateStr(new Date(t));
}

export async function pullReceipts(store, settings, { fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const { url, token } = requireSetup(settings);
  const data = await call(url, { token, action: 'pullExpenses' }, fetchImpl);
  const decimals = currencyDecimals(settings.currency);
  const result = { added: 0, skipped: 0, invalid: 0 };
  for (const r of data.rows ?? []) {
    const id = `tg-${r.key}`;
    if (await store.get('expenses', id)) {
      result.skipped += 1;
      continue;
    }
    const amount = parseMoney(String(r.amount ?? ''), decimals);
    const date = normaliseDate(String(r.date ?? ''));
    if (!amount || amount <= 0 || !date) {
      result.invalid += 1;
      continue;
    }
    const now = new Date().toISOString();
    await store.put('expenses', {
      id,
      date,
      amount,
      taxAmount: 0,
      category: String(r.category || 'Uncategorised').slice(0, 80),
      vendor: String(r.vendor || '').slice(0, 120),
      note: String(r.note || '').slice(0, 300),
      paymentMethod: '',
      source: 'telegram',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      synced: 1, // it came from the sheet, so it must not be pushed back
    });
    result.added += 1;
  }
  return result;
}
