// Settings: business details, tax, lists, receipt, Google Sheets sync, backup, multiple businesses.

import { h, clear, field, toast, confirmDialog, dialog, downloadText, readFileText } from './dom.js';
import { saveSettings, exportBackup, importBackup } from '../services.js';
import { parseList, uid } from '../util.js';
import { pushUnsynced, pullReceipts, pendingCount, SyncError } from '../sync.js';
import { deleteDb, dbNameFor } from '../store.js';
import { toDateStr } from '../reports.js';
import { APP_CONFIG } from '../config.js';

export async function renderSettings(ctx, root) {
  const { settings, store } = ctx;
  const s = structuredClone(settings);

  const name = h('input', { type: 'text', value: s.businessName, maxlength: 60 });
  const taxMode = h('select', {}, h('option', { value: 'exclusive' }, 'Added on top of prices'), h('option', { value: 'inclusive' }, 'Already included in prices'));
  taxMode.value = s.taxMode;
  const registered = h('input', { type: 'checkbox', checked: s.taxRegistered });
  const methods = h('textarea', { rows: 4 }, s.paymentMethods.join('\n'));
  const categories = h('textarea', { rows: 6 }, s.expenseCategories.join('\n'));
  const discounts = h('textarea', { rows: 4 }, s.discountPresets.map((d) => (d.type === 'percent' ? `${d.value}%` : ctx.input(d.value))).join('\n'));
  const header = h('textarea', { rows: 2 }, s.receipt.header);
  const footer = h('textarea', { rows: 2 }, s.receipt.footer);
  const prefix = h('input', { type: 'text', value: s.receipt.prefix, maxlength: 4 });

  // Tax rates (the "No tax" option always exists)
  const rates = s.taxRates.filter((t) => t.id !== 'none').map((t) => ({ ...t }));
  const rateBox = h('div', { class: 'stack' });
  const drawRates = () => {
    clear(rateBox);
    rates.forEach((t, i) => {
      rateBox.append(
        h('div', { class: 'row3' },
          h('input', { type: 'text', value: t.name, maxlength: 40, 'aria-label': 'Tax name', oninput: (e) => (t.name = e.target.value) }),
          h('input', { type: 'number', min: 0, max: 100, step: '0.01', value: t.rate, 'aria-label': 'Rate in percent', oninput: (e) => (t.rate = Number(e.target.value)) }),
          h('button', { class: 'btn small', type: 'button', onclick: () => { rates.splice(i, 1); drawRates(); } }, '✕'),
        ),
      );
    });
    rateBox.append(h('button', { class: 'btn small', type: 'button', onclick: () => { rates.push({ id: uid().slice(0, 6), name: 'New tax', rate: 0 }); drawRates(); } }, '+ Add tax rate'));
  };
  drawRates();

  // Google Sheets sync
  const url = h('input', { type: 'url', value: s.sync.url, placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off' });
  const token = h('input', { type: 'password', value: s.sync.token, autocomplete: 'off', placeholder: 'The secret you set in the script' });
  const syncMsg = h('p', { class: 'muted' }, '');

  async function save() {
    try {
      const code = name.value.trim();
      if (!code) throw new Error('Enter a business name.');
      const cleanRates = rates.map((r) => ({ ...r, name: r.name.trim() || 'Tax', rate: Number(r.rate) }));
      if (cleanRates.some((r) => !(r.rate >= 0 && r.rate <= 100))) throw new Error('Tax rates must be between 0 and 100.');
      const pay = parseList(methods.value);
      const cats = parseList(categories.value);
      if (!pay.length) throw new Error('Add at least one payment method.');
      if (!cats.length) throw new Error('Add at least one expense category.');

      const presets = [];
      for (const line of parseList(discounts.value)) {
        if (line.endsWith('%')) {
          const v = Number(line.slice(0, -1).replace(',', '.'));
          if (!(v > 0 && v <= 100)) throw new Error(`Discount “${line}” is not valid.`);
          presets.push({ label: line, type: 'percent', value: v });
        } else {
          const v = ctx.parse(line);
          if (!(v > 0)) throw new Error(`Discount “${line}” is not valid. Use a number or a percentage like 10%.`);
          presets.push({ label: `${line} off`, type: 'fixed', value: v });
        }
      }

      const next = {
        ...s,
        businessName: code,
        taxMode: taxMode.value,
        taxRegistered: registered.checked,
        taxRates: [{ id: 'none', name: 'No tax', rate: 0 }, ...cleanRates],
        paymentMethods: pay,
        expenseCategories: cats,
        discountPresets: presets,
        receipt: { header: header.value.trim(), footer: footer.value.trim(), prefix: prefix.value.trim() || 'R' },
        sync: { ...s.sync, url: url.value.trim(), token: token.value.trim() },
      };
      await saveSettings(store, next);
      ctx.profiles.rename(ctx.profile.id, next.businessName);
      Object.assign(ctx.settings, next);
      toast('Settings saved.');
      ctx.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function runSync(kind) {
    syncMsg.textContent = 'Working…';
    try {
      await save();
      const live = ctx.settings;
      if (kind === 'push') {
        const sent = await pushUnsynced(store, live);
        live.sync.lastPush = new Date().toISOString();
        await saveSettings(store, live);
        syncMsg.textContent = `Sent ${sent.sales} sale(s) and ${sent.expenses} expense(s).`;
      } else {
        const r = await pullReceipts(store, live);
        live.sync.lastPull = new Date().toISOString();
        await saveSettings(store, live);
        syncMsg.textContent = `Imported ${r.added} new receipt(s). ${r.skipped} already here, ${r.invalid} skipped (missing date or amount).`;
      }
      ctx.afterChange();
    } catch (err) {
      syncMsg.textContent = err instanceof SyncError ? err.message : `Something went wrong: ${err.message}`;
      syncMsg.className = 'error';
    }
  }

  const backupFile = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    onchange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const counts = await importBackup(store, JSON.parse(await readFileText(f)));
        toast(`Restored ${counts.sales} sales, ${counts.expenses} expenses, ${counts.products} items.`);
        const fresh = await store.get('kv', 'settings');
        Object.assign(ctx.settings, fresh.value);
        ctx.reload();
      } catch (err) {
        toast(err instanceof SyntaxError ? 'That file is not a valid backup.' : err.message, 'error');
      }
    },
  });

  async function removeBusiness() {
    if (!(await confirmDialog(`Delete “${ctx.settings.businessName}” and all its sales and expenses from this device? Download a backup first. This cannot be undone.`, 'Delete everything'))) return;
    ctx.store.close();
    await deleteDb(dbNameFor(ctx.profile.id));
    ctx.profiles.remove(ctx.profile.id);
    ctx.restart();
  }

  const pending = await pendingCount(store);
  const section = (title, ...children) => h('section', { class: 'card stack' }, h('h2', {}, title), ...children);
  const businesses = ctx.profiles.list();

  clear(root);
  root.append(
    h('div', { class: 'stack settings' },
      section('Business',
        field('Name', name),
        h('p', { class: 'muted' }, `Type: ${ctx.presetLabel} · Currency: ${s.currency} (fixed after setup so past amounts stay correct)`),
        businesses.length > 1 ? h('p', { class: 'muted' }, `${businesses.length} businesses on this device. Switch from the menu at the top.`) : null,
        h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: () => ctx.addBusiness() }, 'Add another business'), ctx.canInstall() ? h('button', { class: 'btn', type: 'button', onclick: () => ctx.install() }, 'Install app on this device') : null),
      ),
      section('Tax and discounts',
        field('Tax on prices', taxMode, 'Applies to new sales only. Past sales keep how they were recorded.'),
        h('label', { class: 'check' }, registered, ' My business is registered for tax (expenses are shown without recoverable tax)'),
        h('div', {}, h('div', { class: 'field-label' }, 'Tax rates'), rateBox, h('small', { class: 'muted' }, 'Assign a rate to each item in the Items tab. Check current rates with your tax office.')),
        field('Quick discounts', discounts, 'One per line. Use 10% for a percentage or a plain number for a fixed amount.'),
      ),
      section('Lists',
        field('Payment methods', methods, 'One per line. A method containing “cash” asks for the amount received and shows change.'),
        field('Expense categories', categories, 'One per line.'),
      ),
      section('Receipt', field('Top of receipt (address, phone, tax number)', header), field('Bottom of receipt', footer), field('Receipt number prefix', prefix)),
      section('Google Sheets sync',
        h('p', { class: 'muted' }, 'Copies sales and expenses to your Google Sheet and brings in receipts captured by your Telegram bot. Setup steps are in the guide.'),
        field('Web app link', url),
        field('Secret', token),
        h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: () => runSync('push') }, `Send to Sheets${pending ? ` (${pending} waiting)` : ''}`), h('button', { class: 'btn', type: 'button', onclick: () => runSync('pull') }, 'Import Telegram receipts')),
        syncMsg,
        h('small', { class: 'muted' }, `Last sent: ${s.sync.lastPush ? new Date(s.sync.lastPush).toLocaleString() : 'never'} · Last import: ${s.sync.lastPull ? new Date(s.sync.lastPull).toLocaleString() : 'never'}`),
      ),
      section('Backup',
        h('p', { class: 'muted' }, 'Your data lives on this device. Download a backup regularly, and before changing phones or clearing browser data.'),
        h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: async () => downloadText(`${ctx.settings.businessName.replace(/[^\w-]+/g, '_')}_backup_${toDateStr()}.json`, JSON.stringify(await exportBackup(store, ctx.settings.businessName), null, 1), 'application/json') }, 'Download backup')),
        field('Restore from a backup file', backupFile, 'Adds the records in the file to this business.'),
      ),
      h('div', { class: 'toolbar sticky-save' }, h('button', { class: 'btn primary big', type: 'button', onclick: save }, 'Save settings'), h('button', { class: 'btn danger', type: 'button', onclick: removeBusiness }, 'Delete this business')),
      h('p', { class: 'muted small-print' }, `${APP_CONFIG.appName} v${APP_CONFIG.version}`),
    ),
  );
}
