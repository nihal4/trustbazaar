/**
 * Placeholders (NFR-MNT-02) for the concurrency suites that Units 2 and 3 write with their tasks.
 * These are the tests the project's evaluation criteria (docs/proposal.tex,
 * "Evaluation Criteria") actually depend on. Fill each one in as the
 * corresponding feature is built — do not consider a feature "done" until
 * its test here passes under real concurrent load, not just sequentially.
 */
describe('Auction concurrency (FR-AUC-01–FR-AUC-18, NFR-MNT-02)', () => {
  it.todo(
    'NFR-MNT-02 when two bidders submit a bid on the same auction at the same time, ' +
      'exactly one becomes the recorded highest bid and the loser receives ' +
      'a clear rejection, never a silent overwrite',
  );

  it.todo(
    'NFR-MNT-02 a bid placed inside the anti-sniping window extends end_time by the ' +
      'configured amount exactly once, even under concurrent bids',
  );

  it.todo(
    'NFR-MNT-02 proxy bidding automatically outbids a competing bidder up to (but not ' +
      'past) the proxy_max set by the original bidder',
  );
});

describe('Fixed-price purchase concurrency (FR-FIX-01–FR-FIX-05, NFR-MNT-02)', () => {
  it.todo(
    'NFR-MNT-02 when two buyers attempt to purchase the last unit of a listing at the ' +
      'same time, exactly one order is created and the other request is ' +
      'rejected with a clear "sold out" response',
  );
});

describe('Payment webhook idempotency (FR-PAY-01–FR-PAY-21, NFR-MNT-02)', () => {
  it.todo(
    'NFR-MNT-02 a payment-confirmation webhook delivered twice by the provider results ' +
      'in exactly one escrow HELD transition, not two, and does not double-charge',
  );
});

describe('Settlement fee-split correctness (FR-MON-01–FR-MON-10, NFR-MNT-02)', () => {
  it.todo(
    'NFR-MNT-02 seller_payout + platform_commission + courier_payout + ' +
      'platform_delivery_margin always reconciles exactly against the ' +
      "order's total, for both self-pickup (no courier split) and courier orders",
  );
});
