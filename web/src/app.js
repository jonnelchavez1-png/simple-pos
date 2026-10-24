// App shell: opens the active business, draws the header and tabs, runs background sync.

import { createProfiles, openDb, dbNameFor } from './store.js';
import { getSettings, saveSettings } from './services.js';
import { buildSettings, PRESETS } from './presets.js';
import { formatMoney, parseMoney, toInputValue, currencyDecimals } from './money.js';
import { pendingCount, pushUnsynced } from './sync.js';
import { APP_CONFIG } from './config.js';
import { h, clear, toast } from './ui/dom.js';
import { renderSetup } from './ui/setup.js';
import { renderSell } from './ui/sell.js';
import { renderExpenses } from './ui/expenses.js';
import { renderReports } from './ui/reports.js';
import { renderItems } from './ui/items.js';
import { renderSettings } from './ui/settings.js';

const root = document.getElementById('app');
const profiles = createProfiles();
let ctx = null;
let tab = 'sell';
let installEvent = null;
let syncing = false;
let syncTimer = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
});
window.addEventListener('online', () => ctx && autoSync());
window.addEventListener('offline', () => ctx && updateBadge());

const TABS = (L) => [
  { id: 'sell', label: 'Sell', icon: '🛒', render: renderSell },
  { id: 'expenses', label: 'Expenses', icon: '🧾', render: renderExpenses },
  { id: 'reports', label: 'Reports', icon: '📊', render: renderReports },
  { id: 'items', label: L.items, icon: '🏷️', render: renderItems },
  { id: 'settings', label: 'Settings', icon: '⚙️', render: renderSettings },
];

async function openBusiness(profile) {
  if (ctx?.store) ctx.store.close();
  const store = await openDb(dbNameFor(profile.id));
  const saved = await getSettings(store);
  if (!saved) {
    store.close();
    profiles.remove(profile.id);
    return start();
  }
  // Fill in any settings added by newer versions of the app.
  const defaults = buildSettings({ businessName: saved.businessName, businessType: saved.businessType, currency: saved.currency });
  const settings = { ...defaults, ...saved, sync: { ...defaults.sync, ...saved.sync }, receipt: { ...defaults.receipt, ...saved.receipt }, labels: { ...defaults.labels, ...saved.labels } };
  const decimals = currencyDecimals(settings.currency);

  ctx = {
    profiles,
    profile,
    store,
    settings,
    decimals,
    presetLabel: PRESETS[settings.businessType]?.label ?? 'General business',
    session: { cart: { lines: [], orderDiscount: null }, search: '', category: '', period: 'today', from: '', to: '' },
    fmt: (n) => formatMoney(n, { currency: settings.currency }),
    input: (n) => toInputValue(n, decimals),
    parse: (text) => parseMoney(text, decimals),
    afterChange,
    reload: () => draw(),
    restart: () => start(),
    addBusiness: () => showSetup(true),
    canInstall: () => !!installEvent,
    install: async () => {
      if (!installEvent) return;
      installEvent.prompt();
      await installEvent.userChoice;
      installEvent = null;
    },
  };
  navigator.storage?.persist?.().catch(() => {});
  draw();
  autoSync();
}

function showSetup(canCancel) {
  renderSetup({ profiles }, root, {
    onDone: (profile) => {
      tab = 'sell';
      openBusiness(profile);
    },
    onCancel: canCancel ? () => draw() : null,
  });
}

function draw() {
  const { settings } = ctx;
  const tabs = TABS(settings.labels);
  const view = h('div', { id: 'view', class: 'view' });
  const badge = h('button', { id: 'badge', class: 'badge', type: 'button', onclick: () => autoSync(true) });
  const businesses = profiles.list();

  const switcher =
    businesses.length > 1
      ? h('select', { class: 'switcher', 'aria-label': 'Switch business', onchange: (e) => { profiles.setActive(e.target.value); tab = 'sell'; openBusiness(profiles.active()); } }, businesses.map((b) => h('option', { value: b.id, selected: b.id === ctx.profile.id }, b.name)))
      : h('strong', { class: 'biz-name' }, settings.businessName);

  clear(root);
  root.append(
    h('header', { class: 'topbar no-print' }, switcher, badge),
    h('main', {}, view),
    h('nav', { class: 'tabs no-print', 'aria-label': 'Main' }, tabs.map((t) => h('button', { class: `tab ${t.id === tab ? 'on' : ''}`, type: 'button', 'aria-current': t.id === tab ? 'page' : null, onclick: () => { tab = t.id; draw(); } }, h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon), h('span', {}, t.label)))),
  );
  document.title = `${settings.businessName} · ${APP_CONFIG.appName}`;
  tabs.find((t) => t.id === tab).render(ctx, view).catch((err) => {
    console.error(err);
    view.replaceChildren(h('p', { class: 'error' }, `Something went wrong showing this screen: ${err.message}`));
  });
  updateBadge();
}

async function updateBadge() {
  const el = document.getElementById('badge');
  if (!el || !ctx) return;
  const configured = !!(ctx.settings.sync.url && ctx.settings.sync.token);
  const n = await pendingCount(ctx.store);
  const online = navigator.onLine;
  el.hidden = false;
  el.className = 'badge';
  if (!online) {
    el.textContent = n ? `Offline · ${n} waiting` : 'Offline';
    el.classList.add('warn');
  } else if (!configured) {
    el.textContent = 'Saved on this device';
  } else if (n) {
    el.textContent = syncing ? 'Syncing…' : `${n} waiting · tap to sync`;
    el.classList.add('warn');
  } else {
    el.textContent = '✓ Synced';
    el.classList.add('ok');
  }
}

function afterChange() {
  updateBadge();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => autoSync(), 1500);
}

async function autoSync(manual = false) {
  if (!ctx || syncing) return;
  const { settings, store } = ctx;
  const configured = !!(settings.sync.url && settings.sync.token);
  if (!configured) {
    if (manual) toast('Set up Google Sheets sync in Settings first.');
    return;
  }
  if (!APP_CONFIG.autoSync && !manual) return;
  if (!navigator.onLine) {
    if (manual) toast('You are offline. Sales are safe and will be sent later.');
    return;
  }
  if (!(await pendingCount(store))) {
    if (manual) toast('Everything is already synced.');
    updateBadge();
    return;
  }
  syncing = true;
  updateBadge();
  try {
    const sent = await pushUnsynced(store, settings);
    settings.sync.lastPush = new Date().toISOString();
    await saveSettings(store, settings);
    if (manual) toast(`Sent ${sent.sales} sale(s) and ${sent.expenses} expense(s).`);
  } catch (err) {
    if (manual) toast(err.message, 'error');
  } finally {
    syncing = false;
    updateBadge();
  }
}

async function start() {
  const profile = profiles.active();
  if (!profile) return showSetup(false);
  return openBusiness(profile);
}

// Install the service worker so the app opens offline. A new version waits until you reload.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready. Close and reopen the app to update.');
      });
    });
  }).catch(() => {});
}

start().catch((err) => {
  console.error(err);
  root.replaceChildren(h('main', { class: 'setup' }, h('h1', {}, 'Could not start'), h('p', { class: 'error' }, err.message), h('p', { class: 'muted' }, 'If you are in a private window, open the app in a normal window so it can save data.')));
});
