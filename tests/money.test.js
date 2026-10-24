import test from 'node:test';
import assert from 'node:assert/strict';
import { divRound, allocate, parseMoney, toInputValue, formatMoney, currencyDecimals } from '../web/src/money.js';

test('divRound rounds half away from zero', () => {
  assert.equal(divRound(5, 2), 3);
  assert.equal(divRound(-5, 2), -3);
  assert.equal(divRound(7, 3), 2);
  assert.equal(divRound(1, 3), 0);
  assert.equal(divRound(0, 7), 0);
  assert.equal(divRound(999500, 1000), 1000); // 999.5 -> 1000
});

test('divRound is exact for large values', () => {
  assert.equal(divRound(9_000_000_000_000 * 3, 3), 9_000_000_000_000);
});

test('allocate shares a total exactly', () => {
  assert.deepEqual(allocate(100, [1000, 2000]), [33, 67]);
  assert.deepEqual(allocate(10, [1, 1, 1]), [4, 3, 3]);
  for (const total of [0, 1, 7, 99, 1234]) {
    const parts = allocate(total, [333, 500, 167, 1]);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
  }
});

test('allocate with no weight gives zeros', () => {
  assert.deepEqual(allocate(50, [0, 0]), [0, 0]);
  assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
});

test('parseMoney understands common ways of typing amounts', () => {
  assert.equal(parseMoney('12.5'), 1250);
  assert.equal(parseMoney('1,234.50'), 123450);
  assert.equal(parseMoney('12,50'), 1250);
  assert.equal(parseMoney('1.234'), 123400);
  assert.equal(parseMoney('$ 99'), 9900);
  assert.equal(parseMoney('-5'), -500);
  assert.equal(parseMoney('0.005'), 1);
  assert.equal(parseMoney(12.34), 1234);
});

test('parseMoney rejects non-numbers', () => {
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(null), null);
  assert.equal(parseMoney('-'), null);
});

test('parseMoney works for currencies without decimals', () => {
  assert.equal(parseMoney('1,500', 0), 1500);
  assert.equal(parseMoney('1500', 0), 1500);
});

test('toInputValue produces editable strings', () => {
  assert.equal(toInputValue(1250), '12.50');
  assert.equal(toInputValue(5), '0.05');
  assert.equal(toInputValue(-250), '-2.50');
  assert.equal(toInputValue(1500, 0), '1500');
});

test('formatMoney uses the currency', () => {
  assert.equal(currencyDecimals('USD'), 2);
  assert.equal(currencyDecimals('JPY'), 0);
  assert.equal(formatMoney(123456, { currency: 'USD', locale: 'en-US' }), '$1,234.56');
  assert.equal(formatMoney(1500, { currency: 'JPY', locale: 'en-US' }), '¥1,500');
});
