// Reports and date helpers. Pure functions over plain sale and expense records.
//
// Definitions (shown to the user in the Reports screen):
//   Takings      = money received from customers (sale totals, tax included)
//   Net sales    = takings minus tax collected
//   Profit       = net sales minus expenses
//                  (when the business is tax-registered, tax paid on expenses is excluded
//                   from expenses because it is recoverable)
//   Net tax      = tax collected minus tax paid on expenses (an ESTIMATE only)

/** Local calendar date as YYYY-MM-DD. */
export function toDateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** { from, to } (inclusive) for a named period, relative to `today` (YYYY-MM-DD). */
export function periodRange(kind, today) {
  const [y, m, d] = today.split('-').map(Number);
  const iso = (dt) => dt.toISOString().slice(0, 10);
  switch (kind) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y1 = addDays(today, -1);
      return { from: y1, to: y1 };
    }
    case 'week': {
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
      return { from: addDays(today, -((dow + 6) % 7)), to: today }; // weeks start on Monday
    }
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'month':
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: today };
    case 'lastMonth':
      return { from: iso(new Date(Date.UTC(y, m - 2, 1))), to: iso(new Date(Date.UTC(y, m - 1, 0))) };
    case 'year':
      return { from: `${y}-01-01`, to: today };
    default:
      throw new Error(`Unknown period: ${kind}`);
  }
}

const inRange = (date, { from, to }) => date >= from && date <= to;
const bump = (map, key, amount) => map.set(key, (map.get(key) ?? 0) + amount);
const sortedPairs = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);

export function summarize(sales, expenses, range, { taxRegistered = true } = {}) {
  const sold = sales.filter((s) => s.status === 'completed' && inRange(s.date, range));
  const spent = expenses.filter((e) => e.status !== 'deleted' && inRange(e.date, range));

  let gross = 0;
  let discounts = 0;
  let takings = 0;
  let taxCollected = 0;
  const byDay = new Map();
  const byPayment = new Map();
  const items = new Map();

  for (const s of sold) {
    const t = s.totals;
    gross += t.subtotal;
    discounts += t.discount;
    takings += t.total;
    taxCollected += t.tax;
    const day = byDay.get(s.date) ?? { date: s.date, takings: 0, netSales: 0, expenses: 0 };
    day.takings += t.total;
    day.netSales += t.net;
    byDay.set(s.date, day);
    bump(byPayment, s.payment?.method ?? 'Unknown', t.total);
    for (const l of s.lines) {
      const key = l.name;
      const row = items.get(key) ?? { name: l.name, qty: 0, revenue: 0 };
      row.qty += Number(l.qty);
      row.revenue += l.net;
      items.set(key, row);
    }
  }

  let expensesTotal = 0;
  let inputTax = 0;
  const byCategory = new Map();
  for (const e of spent) {
    expensesTotal += e.amount;
    inputTax += e.taxAmount ?? 0;
    const cost = taxRegistered ? e.amount - (e.taxAmount ?? 0) : e.amount;
    bump(byCategory, e.category || 'Uncategorised', cost);
    const day = byDay.get(e.date) ?? { date: e.date, takings: 0, netSales: 0, expenses: 0 };
    day.expenses += cost;
    byDay.set(e.date, day);
  }

  const expensesCost = taxRegistered ? expensesTotal - inputTax : expensesTotal;
  const netSales = takings - taxCollected;
  return {
    range,
    saleCount: sold.length,
    voidedCount: sales.filter((s) => s.status === 'voided' && inRange(s.date, range)).length,
    expenseCount: spent.length,
    gross,
    discounts,
    takings,
    taxCollected,
    netSales,
    expensesTotal,
    inputTax,
    expensesCost,
    profit: netSales - expensesCost,
    netTax: taxCollected - inputTax,
    averageSale: sold.length ? Math.round(takings / sold.length) : 0,
    byDay: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    byPayment: sortedPairs(byPayment).map(([method, amount]) => ({ method, amount })),
    byExpenseCategory: sortedPairs(byCategory).map(([category, amount]) => ({ category, amount })),
    topItems: [...items.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  };
}

/** Rows (arrays of objects) to CSV text. Quotes fields and neutralises spreadsheet formulas. */
export function toCsv(rows, columns) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`; // stop formula injection in Excel/Sheets
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','));
  return [head, ...body].join('\n');
}
