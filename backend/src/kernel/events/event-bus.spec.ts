import { EventBus } from './event-bus';
import { retryDelayMs } from './outbox-dispatcher';

describe('event bus (DC-6)', () => {
  it('DC-6 consumers register for event names of the form <unit>.<entity>.<past>, each once', () => {
    const bus = new EventBus();
    bus.on('identity.kyc.verified', 'listings.badge', async () => undefined);
    bus.on('identity.kyc.verified', 'chat.badge', async () => undefined);
    expect(bus.consumersOf('identity.kyc.verified').map((c) => c.name)).toEqual(['listings.badge', 'chat.badge']);
    expect(() => bus.on('identity.kyc.verified', 'chat.badge', async () => undefined)).toThrow();
    expect(() => bus.on('KycVerified', 'x', async () => undefined)).toThrow();
    expect(bus.consumersOf('orders.order.paid')).toEqual([]);
  });

  it('DV-67 a failed event waits 5 s, doubling, at most an hour', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});
