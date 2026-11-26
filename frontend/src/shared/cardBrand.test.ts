// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cardLooksComplete, detectBrand, formatCardNumber, formatExpiry, maskWallet, walletLooksValid } from './cardBrand';

// FR-PAY-01: the payment sheet of the simulated provider accepts any card details, but tells the buyer which card the number looks like and shapes the
// fields to it. Nothing here validates a real card.

describe('the payment sheet\'s card fields', () => {
  it('FR-PAY-01 recognise Visa, Mastercard, American Express, Discover, Diners, JCB, UnionPay, RuPay and Maestro from the first digits', () => {
    const at = (n: string) => detectBrand(n).id;
    expect(at('4242424242424242')).toBe('visa');
    expect([at('5555555555554444'), at('2223003122003222')]).toEqual(['mastercard', 'mastercard']);
    expect([at('378282246310005'), at('340000000000009')]).toEqual(['amex', 'amex']);
    expect([at('6011111111111117'), at('6500000000000002')]).toEqual(['discover', 'discover']);
    expect([at('30569309025904'), at('36227206271667')]).toEqual(['diners', 'diners']);
    expect(at('3530111333300000')).toBe('jcb');
    expect(at('6200000000000005')).toBe('unionpay');
    expect(at('6070000000000000')).toBe('rupay');
    expect(at('5018000000000000')).toBe('maestro');
    expect([at(''), at('9')]).toEqual(['unknown', 'unknown']);
  });

  it('FR-PAY-01 group the number and size the security code by brand, and accept any card of a plausible shape', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005');
    expect(formatCardNumber('4242 abc 4242')).toBe('4242 4242');
    expect(formatExpiry('1229')).toBe('12/29');
    expect(cardLooksComplete('4242 4242 4242 4242', '12/29', '123')).toBe(true);
    expect(cardLooksComplete('3782 822463 10005', '01/30', '1234')).toBe(true);        // American Express: four digits
    expect(cardLooksComplete('3782 822463 10005', '01/30', '123')).toBe(false);
    expect(cardLooksComplete('4242 4242', '12/29', '123')).toBe(false);
    expect(cardLooksComplete('4242 4242 4242 4242', '13/29', '123')).toBe(false);
  });

  it('FR-PAY-01 take a bKash or Nagad number of eleven digits and show only its first two and last three digits', () => {
    expect(walletLooksValid('01712345678')).toBe(true);
    expect(walletLooksValid('0171234')).toBe(false);
    expect(walletLooksValid('11712345678')).toBe(false);
    expect(maskWallet('01712345678')).toBe('01••••••678');
  });
});
