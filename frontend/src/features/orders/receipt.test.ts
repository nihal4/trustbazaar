// @vitest-environment node
import { describe, expect, it } from 'vitest';
import en from '../../messages/en/orders.json';
import { translator } from '../../shared/language/catalogue';
import { buildReceipt, hasReceipt, receiptFileName } from './receipt';
import type { OrderView } from './model';

// FR-PAY-01 (U10-23): the receipt of a paid order is one self-contained page with the TrustBazaar logo, the lines and the total, and nothing unescaped.
const o = {
  id: 'abcdef12-0000-4000-8000-000000000000',
  role: 'buyer',
  status: 'paid',
  paidAt: '2026-11-26T03:10:00Z',
  quantity: 2,
  itemPrice: '300000',
  deliveryFee: '12000',
  total: '312000',
  fulfilment: 'courier',
  listing: { id: 'l', title: 'Lamp <script>alert(1)</script>', itemKind: 'physical', photoKey: null },
} as unknown as OrderView;

describe('the receipt', () => {
  it('FR-PAY-01 has the logo, the number, the lines and the total, escaped, and exists only once the order is paid', () => {
    const t = translator('en', { en: en as Record<string, string> });
    const html = buildReceipt(o, t, 'en', 'Rahim <b>Traders</b>');
    expect(html).toContain('<svg');
    expect(html).toContain('ABCDEF12');
    expect(html).toContain('৳3,120.00');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<b>Traders');
    expect(receiptFileName(o)).toBe('TrustBazaar-receipt-abcdef12.html');
    expect(hasReceipt(o)).toBe(true);
    expect(hasReceipt({ ...o, status: 'awaiting_payment', paidAt: null })).toBe(false);
  });
});
