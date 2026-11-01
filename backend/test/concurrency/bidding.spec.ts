/**
 * Placeholders (NFR-MNT-02) for the auction concurrency suite, which Unit 3 writes with U3-04.
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

// The fixed-price, webhook and settlement placeholders that were here are real tests now, in orders.spec.ts and
// webhooks.spec.ts (U2-08).
