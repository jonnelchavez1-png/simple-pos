// Reports screen: income, expenses, tax and discounts for a chosen period, plus CSV export.

import { h, clear, downloadText, dialog, field, toast } from './dom.js';
import { summarize, periodRange, toDateStr, toCsv } from '../reports.js';
import { toInputValue } from '../money.js';
import { voidSale } from '../services.js';
import { formatDateTime } from '../receipt.js';
import { showReceipt } from './receiptDialog.js';

const PERIODS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'This week'],
  ['last7', 'Last 7 days'],
  ['month', 'This month'],
  ['lastMonth', 'Last month'],
  ['year', 'This year'],
  ['custom', 'Custom…'],
];

export async function renderReports(ctx, root) {
  const { settings, store, session } = ctx;
  const today = toDateStr();
  let [sales, expenses] = await Promise.all([store.getAll('sales'), store.getAll('expenses')]);

  const select = h('select', { onchange: () => { session.period = select.value; draw(); } }, PERIODS.map(([v, l]) => h('option', { value: v }, l)));
  select.value = session.period;
  const from = h('input', { type: 'date', value: session.from || today, onchange: () => { session.from = from.value; draw(); } });
  const to = h('input', { type: 'date', value: session.to || today, onchange: () => { session.to = to.value; draw(); } });
  const customBox = h('div', { class: 'row2', hidden: true }, from, to);
  const out = h('div', { class: 'stack' });

  const stat = (label, value, cls = '', hint) => h('div', { class: `stat ${cls}` }, h('span', { class: 'stat-label' }, label), h('strong', {}, value), hint ? h('small', { class: 'muted' }, hint) : null);
  const table = (heads, rows, empty) =>
    rows.length
      ? h('table', {}, h('thead', {}, h('tr', {}, heads.map((x, i) => h('th', { class: i ? 'num' : '' }, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: i ? 'num' : '' }, c))))))
      : h('p', { class: 'muted' }, empty);

  function range() {
    if (session.period === 'custom') {
      const f = from.value || today;
      const t = to.value || today;
      return f <= t ? { from: f, to: t } : { from: t, to: f };
    }
    return periodRange(session.period, today);
  }

  function chart(days) {
    if (days.length < 2) return null;
    const max = Math.max(1, ...days.map((d) => Math.max(d.takings, d.expenses)));
    return h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Day by day'),
      h('div', { class: 'bars', role: 'img', 'aria-label': 'Bar chart of takings and expenses per day' },
        days.map((d) => h('div', { class: 'bar-group', title: `${d.date}: takings ${ctx.fmt(d.takings)}, expenses ${ctx.fmt(d.expenses)}` },
          h('div', { class: 'bar sales', style: `height:${Math.round((d.takings / max) * 100)}%` }),
          h('div', { class: 'bar spend', style: `height:${Math.round((d.expenses / max) * 100)}%` }),
        )),
      ),
      h('div', { class: 'legend' }, h('span', { class: 'dot sales' }), ' Takings ', h('span', { class: 'dot spend' }), ' Expenses', h('span', { class: 'muted' }, `  ${days[0].date} → ${days[days.length - 1].date}`)),
    );
  }

  function exportCsv(r) {
    const inR = (d) => d >= r.from && d <= r.to;
    const money = (n) => toInputValue(n, ctx.decimals);
    const saleRows = sales.filter((s) => inR(s.date));
    const expRows = expenses.filter((e) => e.status !== 'deleted' && inR(e.date));
    downloadText(
      `sales_${r.from}_${r.to}.csv`,
      toCsv(saleRows, [
        { label: 'Receipt', value: 'receiptNo' },
        { label: 'Date', value: 'date' },
        { label: 'Status', value: 'status' },
        { label: 'Payment', value: (s) => s.payment?.method },
        { label: 'Subtotal', value: (s) => money(s.totals.subtotal) },
        { label: 'Discount', value: (s) => money(s.totals.discount) },
        { label: 'Tax', value: (s) => money(s.totals.tax) },
        { label: 'Total', value: (s) => money(s.totals.total) },
        { label: 'Items', value: (s) => s.lines.map((l) => `${l.qty} x ${l.name}`).join('; ') },
        { label: 'Note', value: 'note' },
      ]),
      'text/csv',
    );
    downloadText(
      `expenses_${r.from}_${r.to}.csv`,
      toCsv(expRows, [
        { label: 'Date', value: 'date' },
        { label: 'Category', value: 'category' },
        { label: 'Vendor', value: 'vendor' },
        { label: 'Amount', value: (e) => money(e.amount) },
        { label: 'Tax included', value: (e) => money(e.taxAmount || 0) },
        { label: 'Paid by', value: 'paymentMethod' },
        { label: 'Source', value: 'source' },
        { label: 'Note', value: 'note' },
      ]),
      'text/csv',
    );
  }

  async function voidIt(sale) {
    const reason = h('input', { type: 'text', maxlength: 200, placeholder: 'e.g. wrong order, customer cancelled' });
    const result = await dialog({
      title: `Void ${sale.receiptNo}?`,
      body: h('div', { class: 'stack' }, h('p', {}, `This removes ${ctx.fmt(sale.totals.total)} from your takings. The record stays in your history, marked as voided.`), field('Reason (optional)', reason)),
      buttons: [
        { label: 'Keep sale', value: false },
        {
          label: 'Void sale',
          kind: 'danger',
          value: 'voided',
          onClick: async () => {
            await voidSale(store, sale.id, reason.value);
          },
        },
      ],
    });
    if (result !== 'voided') return;
    toast(`${sale.receiptNo} voided.`);
    sales = await store.getAll('sales');
    ctx.afterChange();
    draw();
  }

  function historyCard(r) {
    const LIMIT = 100;
    const all = sales.filter((s) => s.date >= r.from && s.date <= r.to).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const list = h('div', { class: 'list' });
    if (!all.length) list.append(h('p', { class: 'muted' }, 'No sales in this period.'));
    for (const s of all.slice(0, LIMIT)) {
      list.append(
        h('div', { class: `list-row ${s.status === 'voided' ? 'inactive' : ''}` },
          h('div', { class: 'lr-main' }, h('strong', {}, s.receiptNo), h('span', { class: 'muted' }, [formatDateTime(s.createdAt), s.payment?.method, s.status === 'voided' ? 'VOIDED' : ''].filter(Boolean).join(' · '))),
          h('div', { class: 'lr-amount' }, ctx.fmt(s.totals.total)),
          h('button', { class: 'btn small', type: 'button', onclick: () => showReceipt(ctx, s) }, 'View'),
          s.status === 'completed' ? h('button', { class: 'btn small', type: 'button', onclick: () => voidIt(s) }, 'Void') : null,
        ),
      );
    }
    return h('div', { class: 'card' }, h('h3', {}, 'Sales in this period'), list, all.length > LIMIT ? h('p', { class: 'muted' }, `Showing the latest ${LIMIT} of ${all.length}. Download the CSV for the full list.`) : null);
  }

  function draw() {
    customBox.hidden = session.period !== 'custom';
    const r = range();
    const s = summarize(sales, expenses, r, { taxRegistered: settings.taxRegistered });
    clear(out);
    // Element.append(null) would print the word "null", so empty slots are filtered out.
    out.append(...[
      h('div', { class: 'stats' },
        stat('Profit', ctx.fmt(s.profit), s.profit < 0 ? 'bad' : 'good', 'Net sales minus expenses'),
        stat('Takings', ctx.fmt(s.takings), '', `${s.saleCount} sale(s), average ${ctx.fmt(s.averageSale)}`),
        stat('Net sales', ctx.fmt(s.netSales), '', 'Takings without tax'),
        stat('Expenses', ctx.fmt(s.expensesCost), '', `${s.expenseCount} item(s)`),
        stat('Discounts given', ctx.fmt(s.discounts), '', 'Off the full price'),
        stat('Tax collected', ctx.fmt(s.taxCollected)),
        settings.taxRegistered ? stat('Estimated tax to pay', ctx.fmt(s.netTax), '', `Collected minus ${ctx.fmt(s.inputTax)} paid on expenses`) : null,
      ),
      s.voidedCount ? h('p', { class: 'muted' }, `${s.voidedCount} voided sale(s) are not counted.`) : null,
      chart(s.byDay),
      h('div', { class: 'two-col' },
        h('div', { class: 'card' }, h('h3', {}, 'Top ' + settings.labels.items.toLowerCase()), table([settings.labels.item, 'Qty', 'Net sales'], s.topItems.map((i) => [i.name, String(Math.round(i.qty * 1000) / 1000), ctx.fmt(i.revenue)]), 'No sales in this period.')),
        h('div', { class: 'card' }, h('h3', {}, 'Takings by payment method'), table(['Method', 'Amount'], s.byPayment.map((p) => [p.method, ctx.fmt(p.amount)]), 'No sales in this period.')),
      ),
      h('div', { class: 'card' }, h('h3', {}, 'Expenses by category'), table(['Category', 'Amount'], s.byExpenseCategory.map((c) => [c.category, ctx.fmt(c.amount)]), 'No expenses in this period.')),
      h('div', { class: 'card' }, h('h3', {}, 'Tax by rate'), taxTable(sales, r)),
      historyCard(r),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: () => exportCsv(r) }, 'Download CSV files'), h('span', { class: 'muted' }, `${r.from} to ${r.to}`)),
      h('p', { class: 'muted small-print' }, 'Figures are estimates from the sales and expenses entered in this app. Check tax amounts with your accountant or tax office before filing.'),
    ].filter(Boolean));
  }

  function taxTable(allSales, r) {
    const byRate = new Map();
    for (const sale of allSales.filter((x) => x.status === 'completed' && x.date >= r.from && x.date <= r.to)) {
      for (const b of sale.totals.taxBreakdown ?? []) {
        const key = `${b.name}|${b.rate}`;
        const row = byRate.get(key) ?? { name: b.name, rate: b.rate, base: 0, tax: 0 };
        row.base += b.base;
        row.tax += b.tax;
        byRate.set(key, row);
      }
    }
    const rows = [...byRate.values()].map((x) => [x.rate ? `${x.name} (${x.rate}%)` : x.name, ctx.fmt(x.base), ctx.fmt(x.tax)]);
    return rows.length
      ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Rate'), h('th', { class: 'num' }, 'Sales before tax'), h('th', { class: 'num' }, 'Tax'))), h('tbody', {}, rows.map((row) => h('tr', {}, row.map((c, i) => h('td', { class: i ? 'num' : '' }, c))))))
      : h('p', { class: 'muted' }, 'No sales in this period.');
  }

  clear(root);
  root.append(h('div', { class: 'stack' }, h('div', { class: 'toolbar' }, h('h2', {}, 'Reports'), select), customBox, out));
  draw();
}
