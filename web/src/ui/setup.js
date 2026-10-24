// First-run wizard (also used to add another business or restore a backup).

import { h, clear, field, toast, readFileText } from './dom.js';
import { PRESETS, buildSettings, sampleProducts } from '../presets.js';
import { openDb, dbNameFor } from '../store.js';
import { saveSettings, importBackup } from '../services.js';
import { APP_CONFIG } from '../config.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'PHP', 'JPY', 'AUD', 'CAD', 'SGD', 'INR', 'IDR', 'MYR', 'THB', 'VND', 'KRW', 'CNY', 'HKD', 'TWD', 'NZD', 'AED', 'SAR', 'ZAR', 'NGN', 'KES', 'BRL', 'MXN'];

export function renderSetup(ctx, root, { onDone, onCancel } = {}) {
  clear(root);

  const name = h('input', { type: 'text', required: true, maxlength: 60, placeholder: 'e.g. Maria’s Bakery' });
  const type = h('select', {}, Object.entries(PRESETS).map(([k, p]) => h('option', { value: k }, p.label)));
  const currency = h('input', { type: 'text', list: 'currencies', value: 'USD', maxlength: 3, required: true, style: 'text-transform:uppercase' });
  const chargeTax = h('input', { type: 'checkbox' });
  const taxRate = h('input', { type: 'number', min: 0, max: 100, step: '0.01', value: '10', inputmode: 'decimal' });
  const taxMode = h('select', {}, h('option', { value: 'exclusive' }, 'Added on top of the price'), h('option', { value: 'inclusive' }, 'Already included in the price'));
  const samples = h('input', { type: 'checkbox', checked: true });
  const taxBox = h('div', { class: 'stack', hidden: true }, field('Tax rate (%)', taxRate, 'Use the rate that applies to you. You can change it later.'), field('How is tax shown?', taxMode));
  chargeTax.addEventListener('change', () => (taxBox.hidden = !chargeTax.checked));

  async function createBusiness(ev) {
    ev.preventDefault();
    const submit = ev.submitter;
    if (submit) submit.disabled = true;
    try {
      const code = currency.value.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) throw new Error('Currency must be a 3-letter code such as USD or EUR.');
      const taxEnabled = chargeTax.checked && Number(taxRate.value) > 0;
      const settings = buildSettings({
        businessName: name.value,
        businessType: type.value,
        currency: code,
        taxRate: taxEnabled ? Number(taxRate.value) : 0,
        taxMode: taxMode.value,
      });
      const profile = ctx.profiles.add(settings.businessName);
      const store = await openDb(dbNameFor(profile.id));
      await saveSettings(store, settings);
      if (samples.checked) for (const p of sampleProducts(settings.businessType, code, taxEnabled)) await store.put('products', p);
      store.close();
      onDone?.(profile);
    } catch (err) {
      toast(err.message, 'error');
      if (submit) submit.disabled = false;
    }
  }

  async function restore(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await readFileText(file));
      const label = backup.businessName || backup.data?.settings?.businessName || 'Restored business';
      if (!backup.data?.settings) throw new Error('This backup has no settings. Open it from Settings inside an existing business instead.');
      const profile = ctx.profiles.add(label);
      const store = await openDb(dbNameFor(profile.id));
      await importBackup(store, backup);
      store.close();
      toast(`Restored “${label}”.`);
      onDone?.(profile);
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not a valid backup.' : err.message, 'error');
    }
  }

  root.append(
    h(
      'main',
      { class: 'setup' },
      h('h1', {}, APP_CONFIG.appName),
      h('p', { class: 'muted' }, 'Set up your business in under a minute. Everything can be changed later.'),
      h(
        'form',
        { class: 'stack card', onsubmit: createBusiness },
        field('Business name', name),
        field('Type of business', type, 'Sets the wording, expense categories and payment methods. Nothing is locked in.'),
        field('Currency', currency),
        h('datalist', { id: 'currencies' }, CURRENCIES.map((c) => h('option', { value: c }))),
        h('label', { class: 'check' }, chargeTax, ' My business charges tax (VAT, sales tax, etc.)'),
        taxBox,
        h('label', { class: 'check' }, samples, ' Add a few sample items so I can try it'),
        h('button', { class: 'btn primary big', type: 'submit' }, 'Create business'),
        onCancel ? h('button', { class: 'btn', type: 'button', onclick: onCancel }, 'Cancel') : null,
      ),
      h(
        'div',
        { class: 'card stack' },
        h('strong', {}, 'Already have a backup file?'),
        h('input', { type: 'file', accept: 'application/json,.json', onchange: restore }),
        h('small', { class: 'muted' }, 'Restore a business from a backup made in Settings, for example when moving to a new phone.'),
      ),
    ),
  );
  name.focus();
}
