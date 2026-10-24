import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../web/src/store.js';
import { buildSettings } from '../web/src/presets.js';
import { recordSale, addExpense } from '../web/src/services.js';
import { pushUnsynced, pullReceipts, pendingCount, SyncError } from '../web/src/sync.js';

const base = buildSettings({ businessName: 'Sync Shop', currency: 'USD', taxRate: 10 });
const configured = { ...base, sync: { url: 'https://script.example/exec', token: 'secret-token', lastPush: null, lastPull: null } };
const cart = { lines: [{ name: 'A', unitPrice: 500, qty: 1 }] };

const reply = (obj) => async () => ({ ok: true, text: async () => JSON.stringify(obj) });

async function seed(store, n = 1) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push((await recordSale(store, configured, { cart, payment: { method: 'Cash' } })).id);
  return ids;
}

test('push refuses to run before sync is set up', async () => {
  await assert.rejects(() => pushUnsynced(memoryStore(), base, { fetchImpl: reply({ ok: true }) }), SyncError);
});

test('push sends pending records and marks them synced', async () => {
  const store = memoryStore();
  const ids = await seed(store, 2);
  await addExpense(store, { amount: 900, category: 'Rent', date: '2026-10-01' });
  assert.equal(await pendingCount(store), 3);

  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    return {
      ok: true,
      text: async () => JSON.stringify({ ok: true, saved: { sales: (body.sales ?? []).map((s) => s.id), expenses: (body.expenses ?? []).map((e) => e.id) } }),
    };
  };
  const sent = await pushUnsynced(store, configured, { fetchImpl });
  assert.deepEqual(sent, { sales: 2, expenses: 1 });
  assert.equal(await pendingCount(store), 0);
  assert.equal(calls[0].url, 'https://script.example/exec');
  assert.equal(calls[0].body.token, 'secret-token');
  assert.equal(calls[0].headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.ok(ids.every((id) => calls.some((c) => c.body.sales?.some((s) => s.id === id))));
});

test('push leaves records pending when the script does not confirm them', async () => {
  const store = memoryStore();
  await seed(store, 1);
  await pushUnsynced(store, configured, { fetchImpl: reply({ ok: true, saved: { sales: [] } }) });
  assert.equal(await pendingCount(store), 1);
});

test('a record edited during the request stays pending', async () => {
  const store = memoryStore();
  const [id] = await seed(store, 1);
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const cur = await store.get('sales', id);
    await store.put('sales', { ...cur, updatedAt: '2099-01-01T00:00:00.000Z', synced: 0 }); // edited meanwhile
    return { ok: true, text: async () => JSON.stringify({ ok: true, saved: { sales: body.sales.map((s) => s.id) } }) };
  };
  await pushUnsynced(store, configured, { fetchImpl });
  assert.equal(await pendingCount(store), 1);
});

test('push batches large backlogs', async () => {
  const store = memoryStore();
  await seed(store, 30);
  let requests = 0;
  const fetchImpl = async (url, init) => {
    requests += 1;
    const body = JSON.parse(init.body);
    return { ok: true, text: async () => JSON.stringify({ ok: true, saved: { sales: body.sales.map((s) => s.id) } }) };
  };
  await pushUnsynced(store, configured, { fetchImpl });
  assert.equal(requests, 2); // 25 + 5
  assert.equal(await pendingCount(store), 0);
});

test('friendly errors for network failure, HTML replies and script errors', async () => {
  const store = memoryStore();
  await seed(store, 1);
  await assert.rejects(() => pushUnsynced(store, configured, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), /Could not reach Google/);
  await assert.rejects(() => pushUnsynced(store, configured, { fetchImpl: async () => ({ ok: true, text: async () => '<html>Sign in</html>' }) }), /did not return data/);
  await assert.rejects(() => pushUnsynced(store, configured, { fetchImpl: reply({ ok: false, error: 'Wrong token' }) }), /Wrong token/);
  assert.equal(await pendingCount(store), 1);
});

test('pull imports receipt rows as expenses once', async () => {
  const store = memoryStore();
  const rows = [
    { key: 'r2', date: '2026-10-20', vendor: 'Hardware Store', amount: '1,250.50', category: 'Supplies', note: 'nails' },
    { key: 'r3', date: '2026-10-21', vendor: 'Cafe', amount: 85, category: '' },
    { key: 'r4', date: 'not a date', amount: '10' },
    { key: 'r5', date: '2026-10-21', amount: 'free' },
  ];
  const first = await pullReceipts(store, configured, { fetchImpl: reply({ ok: true, rows }) });
  assert.deepEqual(first, { added: 2, skipped: 0, invalid: 2 });
  const second = await pullReceipts(store, configured, { fetchImpl: reply({ ok: true, rows }) });
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 2);

  const all = await store.getAll('expenses');
  const hw = all.find((e) => e.id === 'tg-r2');
  assert.equal(hw.amount, 125050);
  assert.equal(hw.source, 'telegram');
  assert.equal(hw.synced, 1); // never pushed back to the sheet
  assert.equal(all.find((e) => e.id === 'tg-r3').category, 'Uncategorised');
  assert.equal(await pendingCount(store), 0);
});

test('a deleted imported receipt is not re-imported', async () => {
  const store = memoryStore();
  const rows = [{ key: 'r2', date: '2026-10-20', amount: '10' }];
  await pullReceipts(store, configured, { fetchImpl: reply({ ok: true, rows }) });
  const e = await store.get('expenses', 'tg-r2');
  await store.put('expenses', { ...e, status: 'deleted' });
  const again = await pullReceipts(store, configured, { fetchImpl: reply({ ok: true, rows }) });
  assert.equal(again.added, 0);
  assert.equal((await store.get('expenses', 'tg-r2')).status, 'deleted');
});
