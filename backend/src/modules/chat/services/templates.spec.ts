import { render, taka } from './templates';

const T = { titleEn: 'Paid {listing_title}', titleBn: 'পরিশোধ {listing_title}', bodyEn: 'Tk {amount_bdt} for {listing_title}{missing}', bodyBn: '৳{amount_bdt} — {listing_title}' };

describe('notification templates', () => {
  it('FR-NTF-03 a notice is written in the recipient\'s language, with that language\'s digits', () => {
    expect(render(T, { listing_title: 'Lamp', amount_bdt: 15000.5 }, 'en')).toEqual({ title: 'Paid Lamp', body: 'Tk 15,000.5 for Lamp' });
    expect(render(T, { listing_title: 'Lamp', amount_bdt: 1234567 }, 'bn')).toEqual({ title: 'পরিশোধ Lamp', body: '৳১২,৩৪,৫৬৭ — Lamp' });
    expect(render(T, { listing_title: null }, 'en').title).toBe('Paid ');
  });

  it('FR-PAY-14 amounts kept in poisha are shown in taka', () => {
    expect([taka('1500000'), taka(95050), taka(undefined)]).toEqual([15000, 950.5, 0]);
  });
});
