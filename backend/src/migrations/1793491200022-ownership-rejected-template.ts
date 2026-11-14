import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, for Unit 5's U5-02 (Decisions log, 2026-11-15). Runs as tb_owner (SEC-INF-03).
//   The seller's notice that an operator rejected the ownership proof of a game-account listing, with the operator's
//   reason; the listing is back in draft (FR-GAM-03). An approval is told by listing.published. In the app and by
//   e-mail (category transaction). The texts are a draft for the team's review; a corrected text is a new version,
//   never an edit of this migration.
export class OwnershipRejectedTemplate1793491200022 implements MigrationInterface {
  name = 'OwnershipRejectedTemplate1793491200022';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(String.raw`
INSERT INTO notify.templates (code, version, category, channels, allowed_params, title_en, title_bn, body_en, body_bn) VALUES
 ('listing.ownership_rejected', 1, 'transaction', '{email}', '{listing_title,reason}',
  'We could not confirm the account is yours', 'অ্যাকাউন্টটি আপনার কিনা আমরা নিশ্চিত করতে পারিনি',
  'We could not confirm that you own the game account in "{listing_title}": {reason} The listing is back in your drafts; ask for a new code and send a new screenshot.',
  '"{listing_title}" বিজ্ঞাপনের গেম অ্যাকাউন্টটি আপনার কিনা আমরা নিশ্চিত করতে পারিনি: {reason} বিজ্ঞাপনটি আবার আপনার খসড়ায় ফিরেছে; নতুন কোড নিয়ে নতুন স্ক্রিনশট পাঠান।');`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM notify.notifications WHERE template_code = 'listing.ownership_rejected' AND template_version = 1;
      DELETE FROM notify.templates WHERE code = 'listing.ownership_rejected' AND version = 1;`);
  }
}
