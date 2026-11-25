// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { journeyOf } from './Journey';
import type { HandoverView, OrderView, Shipment } from './model';

// FR-DLV-02 FR-DLV-07 (U10-23): a paid order's steps follow how the item is getting to the buyer, and the step it is on is the one marked.
const order = (o: Partial<OrderView>) => ({ status: 'paid', fulfilment: 'self_pickup', deliveryEventAt: null, ...o }) as OrderView;
const handover = (status: HandoverView['status']) => ({ status }) as HandoverView;
const shipment = (status: Shipment['status']) => ({ direction: 'forward', status, provider: 'pathao' }) as Shipment;
const states = (j: ReturnType<typeof journeyOf>) => j?.steps.map((s) => s.state).join(' ');

describe('the journey of a paid order', () => {
  it('FR-DLV-02 meeting the seller: agree a place, meet and check, the handover code, release', () => {
    expect(states(journeyOf(order({}), handover('arranging'), []))).toBe('now next next next');
    expect(states(journeyOf(order({}), handover('agreed'), []))).toBe('done now next next');
    expect(states(journeyOf(order({}), handover('completed'), []))).toBe('done done done now');
    expect(states(journeyOf(order({ status: 'closed' }), handover('completed'), []))).toBe('done done done done');
  });

  it('FR-DLV-07 a courier: the seller sends, it is on the way, it is opened on video, release', () => {
    const c = order({ fulfilment: 'courier' });
    expect(states(journeyOf(c, null, []))).toBe('now next next next');
    expect(states(journeyOf(c, null, [shipment('in_transit')]))).toBe('done now next next');
    expect(states(journeyOf(c, null, [shipment('delivered')]))).toBe('done done now next');
    expect(journeyOf(c, null, [])?.kind).toBe('courier');
  });

  it('FR-DLV-02 no journey before payment or after a cancellation', () => {
    expect(journeyOf(order({ status: 'awaiting_payment' }), null, [])).toBeNull();
    expect(journeyOf(order({ status: 'cancelled' }), null, [])).toBeNull();
  });
});
