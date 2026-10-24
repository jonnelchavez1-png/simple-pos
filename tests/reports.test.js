import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, periodRange, addDays, toCsv } from '../web/src/reports.js';

const sale = (date, total, tax, discount, method = 'Cash', status = 'completed', lines = [{ name: 'Coffee', qty: 1, net: total - tax }]) => ({
  id: `${date}-${total}`,
  date,
  status,
  totals: { subtotal: total - tax + discount, discount, net: total - tax, tax, total },
  payment: { method },
  lines,
});
const expense = (date, amount, taxAmount, category = 'Supplies', status = 'active') => ({ id: `${date}-${amount}`, date, amount, taxAmount, category, status });

const sales = [
  sale('2026-10-01', 1100, 100, 50),
  sale('2026-10-01', 2200, 200, 0, 'Card'),
  sale('2026-10-02', 550, 50, 0, 'Cash', 'voided'),
  sale('2026-11-01', 999, 0, 0), // outside range
];
const expenses = [expense('2026-10-01', 330, 30), expense('2026-10-02', 500, 0, 'Rent'), expense('2026-10-02', 99, 0, 'Misc', 'deleted')];
const range = { from: '2026-10-01', to: '2026-10-31' };

test('summary adds up completed sales only', () => {
  const s = summarize(sales, expenses, range);
  assert.equal(s.saleCount, 2);
  assert.equal(s.voidedCount, 1);
  assert.equal(s.takings, 3300);
  assert.equal(s.taxCollected, 300);
  assert.equal(s.netSales, 3000);
  assert.equal(s.discounts, 50);
  assert.equal(s.averageSale, 1650);
});

test('tax-registered profit excludes recoverable input tax', () => {
  const s = summarize(sales, expenses, range, { taxRegistered: true });
  assert.equal(s.expensesTotal, 830);
  assert.equal(s.inputTax, 30);
  assert.equal(s.expensesCost, 800);
  assert.equal(s.profit, 2200);
  assert.equal(s.netTax, 270);
});

test('not tax-registered: expenses count in full', () => {
  const s = summarize(sales, expenses, range, { taxRegistered: false });
  assert.equal(s.expensesCost, 830);
  assert.equal(s.profit, 2170);
});

test('breakdowns', () => {
  const s = summarize(sales, expenses, range);
  assert.deepEqual(s.byPayment, [{ method: 'Card', amount: 2200 }, { method: 'Cash', amount: 1100 }]);
  assert.deepEqual(s.byExpenseCategory.map((c) => c.category), ['Rent', 'Supplies']);
  assert.equal(s.byDay.length, 2);
  assert.deepEqual(s.byDay[0], { date: '2026-10-01', takings: 3300, netSales: 3000, expenses: 300 });
  assert.equal(s.topItems[0].name, 'Coffee');
  assert.equal(s.topItems[0].qty, 2);
});

test('empty period is all zeros', () => {
  const s = summarize([], [], range);
  assert.equal(s.takings, 0);
  assert.equal(s.profit, 0);
  assert.equal(s.averageSale, 0);
  assert.deepEqual(s.byDay, []);
});

test('periods', () => {
  assert.deepEqual(periodRange('today', '2026-10-23'), { from: '2026-10-23', to: '2026-10-23' });
  assert.deepEqual(periodRange('yesterday', '2026-10-23'), { from: '2026-10-22', to: '2026-10-22' });
  assert.deepEqual(periodRange('week', '2026-10-23'), { from: '2026-10-19', to: '2026-10-23' }); // Fri -> Monday
  assert.deepEqual(periodRange('week', '2026-10-25'), { from: '2026-10-19', to: '2026-10-25' }); // Sunday
  assert.deepEqual(periodRange('last7', '2026-10-23'), { from: '2026-10-17', to: '2026-10-23' });
  assert.deepEqual(periodRange('month', '2026-10-23'), { from: '2026-10-01', to: '2026-10-23' });
  assert.deepEqual(periodRange('lastMonth', '2026-10-23'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(periodRange('lastMonth', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(periodRange('year', '2026-10-23'), { from: '2026-01-01', to: '2026-10-23' });
  assert.throws(() => periodRange('nope', '2026-10-23'));
});

test('addDays crosses month and year ends', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('CSV quotes fields and blocks formula injection', () => {
  const csv = toCsv(
    [{ a: 'plain', b: 'has,comma', c: '=SUM(A1)', d: 'say "hi"', e: -5 }],
    ['a', 'b', 'c', 'd', 'e'].map((k) => ({ label: k, value: k })),
  );
  const [head, row] = csv.split('\n');
  assert.equal(head, 'a,b,c,d,e');
  assert.equal(row, `plain,"has,comma",'=SUM(A1),"say ""hi""",-5`);
});
