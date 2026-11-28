#!/usr/bin/env node
// Makes the fixtures of three order states the demo data has no order in (U11-19), by changing what a recorded fixture says: an order that still has to be paid with the courier to
// choose, an order with a dispute that can still be opened, and a dispute where the seller waits for the item to come back. Nothing is invented but the state: the people, the item and
// the prices are the recorded ones. Run it when the recorded fixtures it starts from are recorded again:
//
//   node e2e/visual/derive-fixtures.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'));
const write = (name, fixture) => writeFileSync(join(here, 'fixtures', `${name}.json`), JSON.stringify(fixture, null, 2) + '\n');
const ok = (body) => ({ status: 200, body });
const orderKey = (f) => Object.keys(f.answers).find((k) => /^GET \/orders\/[^/]+$/.test(k));

// 1. the buyer's order, not yet paid, with the choice of how to get the item still to make (the courier cell and its popup)
{
  const f = read('order-buyer');
  const key = orderKey(f);
  const id = f.path.split('/').pop();
  const recorded = Date.parse(f.recordedAt);
  const o = f.answers[key].body;
  Object.assign(o, {
    status: 'awaiting_payment',
    fulfilment: null,
    fulfilmentStep: null,
    fulfilmentDueAt: null,
    deliveryEventAt: null,
    paidAt: null,
    closedAt: null,
    escrow: null,
    paymentDueAt: new Date(recorded + 3 * 3600_000).toISOString(),
  });
  for (const k of Object.keys(f.answers)) if (k.includes('/ratings') || k.includes('/handover')) delete f.answers[k];
  f.answers['GET /me/addresses'] = ok({
    items: [
      {
        id: '5d0a3c1e-7a52-4e55-9a7f-1d2c3b4a5e61',
        kind: 'dropoff',
        label: 'Home',
        line1: 'House 12, Road 4',
        contactName: 'Test Buyer',
        area: { id: 1, district: 'Dhaka', nameEn: 'Dhanmondi', nameBn: 'ধানমন্ডি' },
        createdAt: new Date(recorded - 86400_000).toISOString(),
      },
    ],
  });
  f.answers['GET /delivery/areas'] = ok({ items: [{ id: 1, district: 'Dhaka', nameEn: 'Dhanmondi', nameBn: 'ধানমন্ডি' }] });
  f.path = `/orders/${id}`;
  write('order-buyer-pay', f);
}

// 2. the buyer's order, paid, where a dispute can be opened (the dispute cell and its popup)
{
  const f = read('order-buyer');
  const key = orderKey(f);
  const id = f.path.split('/').pop();
  const o = f.answers[key].body;
  Object.assign(o, { status: 'paid', closedAt: null });
  o.escrow = { ...o.escrow, state: 'held' };
  f.answers[`GET /orders/${id}/dispute-types`] = ok({ types: ['not_as_described', 'damaged', 'other'], openDisputeId: null });
  write('order-buyer-dispute', f);
}

// 3. the dispute page of the seller while the item comes back by a meetup (the return cell and its popup)
{
  const f = read('dispute-seller');
  const key = Object.keys(f.answers).find((k) => /^GET \/disputes\/[^/]+$/.test(k));
  const d = f.answers[key].body;
  Object.assign(d, { status: 'awaiting_return', returnStep: { manual: true, last4: '4821', check: 'none' } });
  const chat = Object.keys(f.answers).find((k) => k.endsWith('/chat'));
  if (chat) f.answers[chat].body.status = 'awaiting_return';
  write('dispute-seller-return', f);
}
console.log('order-buyer-pay, order-buyer-dispute and dispute-seller-return written');
