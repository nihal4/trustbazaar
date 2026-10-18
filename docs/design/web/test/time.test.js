import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTime, formatCountdown, formatDeadline, ServerClock } from '../src/time.js';

const T = Date.UTC(2026, 9, 20, 12, 0);   // 20 Oct 2026 12:00 UTC = 18:00 in Dhaka

test('NFR-USE-08 times are shown in Dhaka time with the date, whatever the device zone', () => {
  assert.equal(formatDateTime(T, 'en'), 'Tue 20 Oct 2026, 6:00 pm');
  assert.equal(formatDateTime(T, 'bn'), 'মঙ্গল ২০ অক্টো ২০২৬, ৬:০০ অপরাহ্ণ');
});

test('the date changes at Dhaka midnight, not UTC midnight', () => {
  assert.equal(formatDateTime(Date.UTC(2026, 9, 20, 18, 30), 'en'), 'Wed 21 Oct 2026, 12:30 am');
  assert.equal(formatDateTime(Date.UTC(2026, 9, 20, 6, 0), 'en'), 'Tue 20 Oct 2026, 12:00 pm');
  assert.equal(formatDateTime(Date.UTC(2026, 9, 20, 6, 0), 'bn'), 'মঙ্গল ২০ অক্টো ২০২৬, ১২:০০ অপরাহ্ণ');
  assert.equal(formatDateTime(Date.UTC(2026, 9, 19, 23, 5), 'bn'), 'মঙ্গল ২০ অক্টো ২০২৬, ৫:০৫ পূর্বাহ্ণ');
});

test('countdowns', () => {
  assert.deepEqual(formatCountdown(0), { text: 'Ended', ended: true, urgent: false });
  assert.equal(formatCountdown(-5).text, 'Ended');
  assert.equal(formatCountdown(65_000).text, '1:05');
  assert.equal(formatCountdown(1).text, '0:01');            // never shows 0:00 before the end
  assert.equal(formatCountdown(300_000).urgent, true);
  assert.equal(formatCountdown(301_000).urgent, false);
  assert.equal(formatCountdown(3_600_000).text, '1 h 00 min');
  assert.equal(formatCountdown(86_400_000).text, '1 day 0 h');
  assert.equal(formatCountdown(2 * 86_400_000 + 3 * 3_600_000).text, '2 days 3 h');
  assert.equal(formatCountdown(2 * 86_400_000 + 3 * 3_600_000, 'bn').text, '২ দিন ৩ ঘণ্টা');
  assert.equal(formatCountdown(65_000, 'bn').text, '১:০৫');
});

test('a deadline is a time and a countdown', () => {
  assert.equal(formatDeadline(T, T - 2 * 86_400_000 - 3_600_000, 'en'), 'Tue 20 Oct 2026, 6:00 pm (in 2 days 1 h)');
  assert.equal(formatDeadline(T, T + 1, 'en'), 'Tue 20 Oct 2026, 6:00 pm (Ended)');
  assert.equal(formatDeadline(T, T - 65_000, 'bn'), 'মঙ্গল ২০ অক্টো ২০২৬, ৬:০০ অপরাহ্ণ (আর ১:০৫)');
});

test('server clock: HTTP samples bound the offset on both sides', () => {
  let local = 1_000_000;
  const c = new ServerClock({ now: () => local });
  // device 5 s behind the server; request took 200 ms
  c.sampleHttp(1_005_100, 1_000_000, 1_000_200);
  assert.ok(Math.abs(c.offset - 5_000) <= 100, String(c.offset));
  c.sampleHttp(1_006_020, 1_001_000, 1_001_040);   // a faster request narrows it
  assert.ok(Math.abs(c.offset - 5_000) <= 20, String(c.offset));
  local = 1_010_000;
  assert.ok(Math.abs(c.now() - 1_015_000) <= 20);
});

test('server clock: a delayed live message never pulls the estimate down', () => {
  const c = new ServerClock();
  c.sampleHttp(10_000, 0, 100);                 // offset in [9900, 10000]
  c.sampleMessage(10_500, 1_000);               // delayed: lower bound 9500, ignored by the intersection
  assert.equal(c.offset, 9_950);
  c.sampleMessage(11_980, 2_000);               // lower bound 9980 narrows it
  assert.equal(c.offset, 9_990);
});

test('server clock: a device clock jump resets to the newest sample', () => {
  const c = new ServerClock();
  c.sampleHttp(10_000, 0, 100);
  c.sampleHttp(10_000, 60_000, 60_100);         // device jumped 60 s forward
  assert.equal(c.offset, -50_050);
});

test('server clock: message samples alone give the best lower bound', () => {
  const c = new ServerClock({ window: 3 });
  c.sampleMessage(5_000, 1_000);
  c.sampleMessage(6_500, 2_000);
  assert.equal(c.offset, 4_500);
  assert.equal(new ServerClock().offset, 0);
});
