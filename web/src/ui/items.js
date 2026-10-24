// Items screen (called Products, Menu, Services... depending on the business type).

import { h, clear, dialog, field, toast, confirmDialog } from './dom.js';
import { saveProduct } from '../services.js';

export async function renderItems(ctx, root) {
  const { settings, store } = ctx;
  const L = settings.labels;
  const listBox = h('div', { class: 'list' });
  const search = h('input', { type: 'search', placeholder: `Search ${L.items.toLowerCase()}…`, oninput: () => draw() });
  let products = [];

  async function edit(p) {
    const isNew = !p;
    const name = h('input', { type: 'text', maxlength: 80, value: p?.name ?? '' });
    const price = h('input', { type: 'text', inputmode: 'decimal', value: p ? ctx.input(p.price) : '', placeholder: '0.00' });
    const cats = [...new Set(products.map((x) => x.category).filter(Boolean))];
    const category = h('input', { type: 'text', maxlength: 40, list: 'item-cats', value: p?.category ?? '' });
    const tax = h('select', {}, settings.taxRates.map((t) => h('option', { value: t.id }, t.rate ? `${t.name} (${t.rate}%)` : t.name)));
    tax.value = p?.taxId ?? (settings.taxRates.find((t) => t.id === 'std') ? 'std' : 'none');
    const active = h('input', { type: 'checkbox', checked: p ? p.active : true });
    await dialog({
      title: isNew ? `New ${L.item.toLowerCase()}` : `Edit ${L.item.toLowerCase()}`,
      body: h('div', { class: 'stack' }, field('Name', name), field(settings.taxMode === 'inclusive' ? 'Price (tax included)' : 'Price (before tax)', price), field('Group', category, 'Optional. Used for the filter buttons on the Sell screen.'), h('datalist', { id: 'item-cats' }, cats.map((c) => h('option', { value: c }))), field('Tax', tax), h('label', { class: 'check' }, active, ' Show on the Sell screen')),
      buttons: [
        { label: 'Cancel', value: false },
        {
          label: 'Save',
          kind: 'primary',
          onClick: async () => {
            const parsed = ctx.parse(price.value);
            if (parsed == null || parsed < 0) throw new Error('Enter a price.');
            await saveProduct(store, { id: p?.id, name: name.value, price: parsed, category: category.value, taxId: tax.value, active: active.checked });
            toast('Saved.');
            await draw(true);
          },
        },
      ],
    });
  }

  async function draw(reload = false) {
    if (reload || !products.length) products = (await store.getAll('products')).sort((a, b) => a.name.localeCompare(b.name));
    const q = search.value.trim().toLowerCase();
    const rows = products.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
    clear(listBox);
    if (!rows.length) listBox.append(h('p', { class: 'muted empty' }, products.length ? 'Nothing matches.' : `No ${L.items.toLowerCase()} yet. Tap “Add” to create the first one.`));
    for (const p of rows) {
      const rate = settings.taxRates.find((t) => t.id === p.taxId);
      listBox.append(
        h('div', { class: `list-row ${p.active ? '' : 'inactive'}` },
          h('div', { class: 'lr-main' }, h('strong', {}, p.name), h('span', { class: 'muted' }, [p.category, rate && rate.rate ? `${rate.name} ${rate.rate}%` : '', p.active ? '' : 'hidden'].filter(Boolean).join(' · '))),
          h('div', { class: 'lr-amount' }, ctx.fmt(p.price)),
          h('button', { class: 'btn small', type: 'button', onclick: () => edit(p) }, 'Edit'),
          h('button', { class: 'btn small', type: 'button', 'aria-label': `Delete ${p.name}`, onclick: async () => { if (await confirmDialog(`Delete “${p.name}”? Past sales keep their records.`, 'Delete')) { await store.delete('products', p.id); await draw(true); } } }, '✕'),
        ),
      );
    }
  }

  clear(root);
  root.append(h('div', { class: 'stack' }, h('div', { class: 'toolbar' }, h('h2', {}, L.items), h('button', { class: 'btn primary', type: 'button', onclick: () => edit(null) }, `Add ${L.item.toLowerCase()}`)), search, h('div', { class: 'card' }, listBox)));
  await draw(true);
}
