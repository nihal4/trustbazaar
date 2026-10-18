import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuctionFeed, ChatThread } from '../src/live.js';

test('auction: only newer states are applied, in any arrival order', () => {
  const f = new AuctionFeed();
  const s = (seq) => ({ seq, price: seq * 100, endAt: 0, serverTime: 0 });
  const order = [3, 1, 2, 5, 4, 5, 6];
  const applied = order.filter((q) => f.apply(s(q)));
  assert.deepEqual(applied, [3, 5, 6]);
  assert.equal(f.state.seq, 6);
});

test('auction: the state fetched after a reconnection is applied only if newer', () => {
  const f = new AuctionFeed();
  f.apply({ seq: 10, price: 1, endAt: 0, serverTime: 0 });
  assert.equal(f.apply({ seq: 9, price: 0, endAt: 0, serverTime: 0 }), false);
  assert.equal(f.apply({ seq: 12, price: 2, endAt: 0, serverTime: 0 }), true);
});

const m = (seq, id = `c${seq}`) => ({ seq, clientMsgId: id, senderId: 'u' });

test('chat: in-order messages append; duplicates are ignored', () => {
  const t = new ChatThread();
  [1, 2, 2, 3, 1].forEach((q) => t.receive(m(q)));
  assert.deepEqual(t.messages.map((x) => x.seq), [1, 2, 3]);
  assert.equal(t.needsResync, false);
});

test('chat: a gap asks for a resync, which fills it in order', () => {
  const t = new ChatThread();
  t.receive(m(1));
  t.receive(m(4));
  assert.equal(t.needsResync, true);
  assert.equal(t.lastSeq, 1);
  t.resync([m(4), m(2), m(3)]);
  assert.deepEqual(t.messages.map((x) => x.seq), [1, 2, 3, 4]);
  assert.equal(t.needsResync, false);
});

test('chat: our pending message is confirmed by its client id, once', () => {
  const t = new ChatThread();
  t.send('hello', 'abc');
  t.send('hello', 'abc');                 // a resend after a timeout keeps the same id
  assert.equal(t.pending.size, 1);
  t.receive(m(1, 'abc'));
  assert.equal(t.pending.size, 0);
  assert.equal(t.messages.length, 1);
});

test('chat: 200 messages shuffled and partly lost end complete and ordered after resync', () => {
  const all = Array.from({ length: 200 }, (_, i) => m(i + 1));
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const arrived = all.filter(() => rnd() > 0.2).sort(() => rnd() - 0.5);
  const t = new ChatThread();
  for (const x of arrived) {
    t.receive(x);
    if (t.needsResync) t.resync(all.filter((y) => y.seq > t.lastSeq).slice(0, 50));
  }
  while (t.lastSeq < 200) t.resync(all.filter((y) => y.seq > t.lastSeq).slice(0, 50));
  assert.deepEqual(t.messages.map((x) => x.seq), all.map((x) => x.seq));
});
