// Plain-text receipt. One source of truth for what is shown, printed and shared.

import { formatMoney } from './money.js';

const WIDTH = 32;
const pad2 = (n) => String(n).padStart(2, '0');

const row = (left, right = '') => {
  const l = left.length + right.length + 1 > WIDTH ? left.slice(0, Math.max(1, WIDTH - right.length - 1)) : left;
  return l + ' '.repeat(Math.max(1, WIDTH - l.length - right.length)) + right;
};
const center = (s) => ' '.repeat(Math.max(0, Math.floor((WIDTH - s.length) / 2))) + s;

export function formatDateTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function receiptText(sale, settings) {
  const currency = sale.currency || settings.currency;
  const f = (n) => formatMoney(n, { currency });
  const t = sale.totals;
  const out = [];

  out.push(center(settings.businessName));
  for (const line of String(settings.receipt?.header ?? '').split('\n').filter(Boolean)) out.push(center(line));
  out.push('-'.repeat(WIDTH));
  out.push(row('Receipt', sale.receiptNo));
  out.push(row('Date', formatDateTime(sale.createdAt)));
  if (sale.status === 'voided') out.push(center('*** VOIDED ***'));
  out.push('-'.repeat(WIDTH));

  for (const l of sale.lines) {
    out.push(row(`${l.qty} x ${l.name}`, f(l.gross)));
    if (l.qty !== 1) out.push(`   @ ${f(l.unitPrice)}`);
    if (l.lineDiscount > 0) out.push(row('   Discount', `-${f(l.lineDiscount)}`));
  }

  out.push('-'.repeat(WIDTH));
  out.push(row('Subtotal', f(t.subtotal)));
  if (t.lineDiscounts > 0) out.push(row('Item discounts', `-${f(t.lineDiscounts)}`));
  if (t.orderDiscount > 0) out.push(row('Order discount', `-${f(t.orderDiscount)}`));
  const taxRows = (t.taxBreakdown ?? []).filter((b) => b.tax > 0);
  for (const b of taxRows) {
    const label = sale.taxMode === 'inclusive' ? `Incl. ${b.name} ${b.rate}%` : `${b.name} ${b.rate}%`;
    out.push(row(label, f(b.tax)));
  }
  out.push(row('TOTAL', f(t.total)));
  out.push('-'.repeat(WIDTH));
  out.push(row('Paid by', sale.payment?.method ?? ''));
  if (sale.payment?.tendered != null) {
    out.push(row('Received', f(sale.payment.tendered)));
    out.push(row('Change', f(sale.payment.change)));
  }
  const footer = String(settings.receipt?.footer ?? '').split('\n').filter(Boolean);
  if (footer.length) {
    out.push('');
    for (const line of footer) out.push(center(line));
  }
  return out.join('\n');
}
