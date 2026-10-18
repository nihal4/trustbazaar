import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, parseTaka, toAsciiDigits } from '../src/money.js';

test('lakh grouping with the taka sign first', () => {
  assert.equal(formatMoney(123456750), '৳12,34,567.50');
  assert.equal(formatMoney(100), '৳1');
  assert.equal(formatMoney(99), '৳0.99');
  assert.equal(formatMoney(100000), '৳1,000');
  assert.equal(formatMoney(10000000), '৳1,00,000');
  assert.equal(formatMoney(1000000000000), '৳10,00,00,00,000');   // 1,000 crore taka
});

test('Bangla digits in Bangla', () => {
  assert.equal(formatMoney(123456750, 'bn'), '৳১২,৩৪,৫৬৭.৫০');
  assert.equal(toAsciiDigits(formatMoney(123456750, 'bn')), '৳12,34,567.50');
});

test('decimals: auto drops .00, always keeps it', () => {
  assert.equal(formatMoney(125000), '৳1,250');
  assert.equal(formatMoney(125000, 'en', { decimals: 'always' }), '৳1,250.00');
  assert.equal(formatMoney(6250, 'en', { decimals: 'always' }), '৳62.50');
});

test('signs and exactness beyond floating point', () => {
  assert.equal(formatMoney(-5000), '−৳50');
  assert.equal(formatMoney(5000, 'en', { sign: true }), '+৳50');
  assert.equal(formatMoney(0), '৳0');
  assert.equal(formatMoney(9007199254740993n), '৳9,00,71,99,25,47,409.93');   // above 2^53
  assert.equal(formatMoney('12345'), '৳123.45');
});

test('non-integer amounts are refused', () => {
  assert.throws(() => formatMoney(12.5), RangeError);
  assert.throws(() => formatMoney('12.5'), TypeError);
  assert.throws(() => formatMoney(Number.MAX_SAFE_INTEGER + 2), RangeError);
});

test('typed amounts become exact poisha', () => {
  const ok = (s, p) => assert.deepEqual(parseTaka(s), { ok: true, poisha: p }, s);
  ok('1250', 125000n);
  ok('1,250.5', 125050n);
  ok('12,34,567.89', 123456789n);
  ok('1,234,567', 123456700n);
  ok(' ৳ 500 ', 50000n);
  ok('Tk 0.01', 1n);
  ok('BDT 10', 1000n);
  ok('১২৫০.৭৫', 125075n);
  ok('৳১,২৫০', 125000n);
  ok('0.1', 10n);              // 0.1 taka is 10 poisha, not 9.999...
});

test('bad input is refused with its reason', () => {
  const bad = (s, r) => assert.deepEqual(parseTaka(s), { ok: false, reason: r }, s);
  bad('', 'empty');
  bad('   ', 'empty');
  bad('12.345', 'decimals');
  bad('-5', 'format');
  bad('1e5', 'format');
  bad('12,3', 'format');
  bad('1,,000', 'format');
  bad('abc', 'format');
  bad('5.', 'format');
  bad('100000000000', 'too_large');
});
