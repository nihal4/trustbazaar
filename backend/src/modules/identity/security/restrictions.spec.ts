import { sanctionRestrictions } from './restrictions';

// I-43 (U7-04): which of Unit 7's restrictions refuses which verified action.
describe('sanctionRestrictions', () => {
  const with_ = (r: { canSell: boolean; canBuyBid: boolean; fraudHold: boolean }) => {
    const restrictions = jest.fn(async () => r);
    return { restrictions, check: sanctionRestrictions({ get: (() => ({ restrictions })) as never }) };
  };

  it('I-43 FR-TNS-03 listing needs canSell, bidding and buying need canBuyBid; payouts are not refused here', async () => {
    const selling = with_({ canSell: false, canBuyBid: true, fraudHold: true });
    expect(await Promise.all((['list', 'bid', 'buy', 'payout'] as const).map((a) => selling.check.isRestricted('U', a)))).toEqual([true, false, false, false]);
    const buying = with_({ canSell: true, canBuyBid: false, fraudHold: false });
    expect(await Promise.all((['list', 'bid', 'buy'] as const).map((a) => buying.check.isRestricted('U', a)))).toEqual([false, true, true]);
    expect(buying.restrictions).toHaveBeenCalledWith('U');
  });
});
