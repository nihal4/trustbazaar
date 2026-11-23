import { loadConfig } from '../../src/kernel/config/config';
import { useTestSecrets } from '../support/env';

// SEC-PAY-05: sandbox and production provider credentials are separate: a build configured for sandbox refuses
// production credentials, and the reverse. The deliverable never moves real money (C-2): only mock and sandbox modes
// exist, and a live key is refused in every mode.
useTestSecrets();
const base = { ...process.env };
const configWith = (env: Record<string, string | undefined>) => () => loadConfig({ ...base, ...env });

describe('SEC-PAY-05 separate credentials', () => {
  it('SEC-PAY-05 a live Stripe key is refused, in sandbox and in mock mode', () => {
    for (const mode of ['sandbox', 'mock']) {
      expect(configWith({ PAYMENT_MODE: mode, STRIPE_SECRET_KEY: 'sk_live_0123456789abcdefghij', STRIPE_WEBHOOK_SECRET: 'whsec_test_only_0123456789' })).toThrow(/STRIPE_SECRET_KEY: must be a test key/);
    }
  });

  it('SEC-PAY-05 sandbox mode needs its own test credentials, and accepts them', () => {
    expect(configWith({ PAYMENT_MODE: 'sandbox', STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined })).toThrow(/required when PAYMENT_MODE is sandbox/);
    expect(configWith({ PAYMENT_MODE: 'sandbox', STRIPE_SECRET_KEY: 'sk_test_only_0123456789abcdef', STRIPE_WEBHOOK_SECRET: 'whsec_test_only_0123456789' })().paymentMode).toBe('sandbox');
  });

  it('SEC-PAY-05 there is no production payment mode to configure', () => {
    expect(configWith({ PAYMENT_MODE: 'production' })).toThrow(/PAYMENT_MODE/);
    expect(configWith({ PAYMENT_MODE: 'live' })).toThrow(/PAYMENT_MODE/);
  });

  it('SEC-PAY-05 a webhook secret that is not a signing secret is refused', () => {
    expect(configWith({ PAYMENT_MODE: 'sandbox', STRIPE_SECRET_KEY: 'sk_test_only_0123456789abcdef', STRIPE_WEBHOOK_SECRET: 'sk_test_only_0123456789abcdef' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});
