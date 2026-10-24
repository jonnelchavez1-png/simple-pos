// Expenses screen: record money going out, see the month's list, delete mistakes.

import { h, clear, field, toast, confirmDialog } from './dom.js';
import { addExpense, deleteExpense } from '../services.js';
import { toDateStr } from '../reports.js';

export async function renderExpenses(ctx, root) {
  const { settings, store } = ctx;
  const today = toDateStr();

  const date = h('input', { type: 'date', value: today, required: true });
  const amount = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', required: true, autocomplete: 'off' });
  const tax = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
  const category = h('select', {}, settings.expenseCategories.map((c) => h('option', { value: c }, c)));
  const vendor = h('input', { type: 'text', maxlength: 120, placeholder: 'Who was paid?' });
  const note = h('input', { type: 'text', maxlength: 200, placeholder: 'Optional' });
  const method = h('select', {}, h('option', { value: '' }, '—'), settings.paymentMethods.map((m) => h('option', { value: m }, m)));

  const month = h('input', { type: 'month', value: today.slice(0, 7), onchange: () => drawList() });
  const listBox = h('div', { class: 'list' });
  const totalEl = h('strong', {}, '');

  async function submit(ev) {
    ev.preventDefault();
    const btn = ev.submitter;
    btn.disabled = true;
    try {
      const a = ctx.parse(amount.value);
      if (a == null) throw new Error('Enter the amount as a number.');
      const t = tax.value.trim() ? ctx.parse(tax.value) : 0;
      if (t == null) throw new Error('Enter the tax paid as a number, or leave it empty.');
      await addExpense(store, { date: date.value, amount: a, taxAmount: t, category: category.value, vendor: vendor.value, note: note.value, paymentMethod: method.value });
      amount.value = tax.value = vendor.value = note.value = '';
      toast('Expense saved.');
      ctx.afterChange();
      await drawList();
      amount.focus();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function drawList() {
    const ym = month.value || today.slice(0, 7);
    const rows = (await store.getAll('expenses'))
      .filter((e) => e.status !== 'deleted' && e.date.startsWith(ym))
      .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
    totalEl.textContent = `${rows.length} item(s) · ${ctx.fmt(rows.reduce((s, e) => s + e.amount, 0))}`;
    clear(listBox);
    if (!rows.length) listBox.append(h('p', { class: 'muted empty' }, 'No expenses this month.'));
    for (const e of rows) {
      listBox.append(
        h(
          'div',
          { class: 'list-row' },
          h('div', { class: 'lr-main' }, h('strong', {}, e.vendor || e.category), h('span', { class: 'muted' }, [e.date, e.vendor ? e.category : '', e.note, e.source === 'telegram' ? 'from Telegram' : ''].filter(Boolean).join(' · '))),
          h('div', { class: 'lr-amount' }, ctx.fmt(e.amount), e.taxAmount ? h('small', { class: 'muted' }, `tax ${ctx.fmt(e.taxAmount)}`) : null),
          h('button', { class: 'btn small', type: 'button', 'aria-label': 'Delete expense', onclick: async () => { if (await confirmDialog(`Delete this ${ctx.fmt(e.amount)} expense?`, 'Delete')) { await deleteExpense(store, e.id); ctx.afterChange(); drawList(); } } }, '✕'),
        ),
      );
    }
  }

  clear(root);
  root.append(
    h('div', { class: 'two-col' },
      h('form', { class: 'card stack', onsubmit: submit },
        h('h2', {}, 'Add expense'),
        h('div', { class: 'row2' }, field('Date', date), field('Amount', amount)),
        field('Category', category),
        settings.taxRegistered ? field('Tax included in this amount', tax, 'Optional. Used to estimate the tax you can claim back.') : null,
        field('Vendor', vendor),
        h('div', { class: 'row2' }, field('Paid by', method), field('Note', note)),
        h('button', { class: 'btn primary big', type: 'submit' }, 'Save expense'),
      ),
      h('section', { class: 'card stack' }, h('div', { class: 'toolbar' }, h('h2', {}, 'Expenses'), month), totalEl, listBox),
    ),
  );
  await drawList();
}
