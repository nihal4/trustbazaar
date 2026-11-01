import type Redis from 'ioredis';
import type { TbConfig } from '../../../kernel/config/config';
import { signState } from './callback-state';
import { MockProvider } from './mock-provider';
import type { PaymentProvider, ProviderId } from './payment-provider';
import { Fetch, StripeProvider } from './stripe-provider';

/**
 * The adapters of the configured mode (C-2): in mock mode all three providers are simulated (the mock page
 * at /api/v1/mock-provider/{attempt}); in sandbox mode Stripe's test mode, and bKash and Nagad with U2-09.
 */
export function buildProviders(config: TbConfig, redis: Redis, fetchFn: Fetch = fetch as unknown as Fetch): Partial<Record<ProviderId, PaymentProvider>> {
  if (config.paymentMode === 'mock') {
    const key = config.secrets.callbackStateKey.reveal();
    const page = (id: string) => `${config.publicOrigin}/api/v1/mock-provider/${id}?state=${signState(key, id)}`;
    return Object.fromEntries((['bkash', 'nagad', 'stripe'] as const).map((p) => [p, new MockProvider(p, redis, page)]));
  }
  const stripeKey = config.providers.stripeSecretKey;
  return stripeKey ? { stripe: new StripeProvider(stripeKey.reveal(), fetchFn) } : {};
}
