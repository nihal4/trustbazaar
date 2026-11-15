import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, for Unit 3's U3-08 (Decisions log, 2026-11-15). Runs as tb_owner (SEC-INF-03).
//   The seller's notices that an operator returned a listing held for review to their drafts, or removed a listing
//   for a policy breach, each with the operator's reason (FR-LST-11, FR-LST-12). In the app and by e-mail (category
//   transaction). The texts are a draft for the team's review; a corrected text is a new version, never an edit here.
const CODES = ['listing.returned', 'listing.removed'];

export class ListingReviewTemplates1793491200026 implements MigrationInterface {
  name = 'ListingReviewTemplates1793491200026';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(String.raw`
INSERT INTO notify.templates (code, version, category, channels, allowed_params, title_en, title_bn, body_en, body_bn) VALUES
 ('listing.returned', 1, 'transaction', '{email}', '{listing_title,reason}',
  'Your listing needs changes', 'আপনার বিজ্ঞাপনে পরিবর্তন দরকার',
  'We reviewed "{listing_title}" and returned it to your drafts: {reason} Change it and publish it again.',
  'আমরা "{listing_title}" পর্যালোচনা করে আপনার খসড়ায় ফিরিয়ে দিয়েছি: {reason} পরিবর্তন করে আবার প্রকাশ করুন।'),
 ('listing.removed', 1, 'transaction', '{email}', '{listing_title,reason}',
  'Your listing was removed', 'আপনার বিজ্ঞাপন সরানো হয়েছে',
  'We removed "{listing_title}" because it breaks our listing rules: {reason} If you think this is a mistake, contact support.',
  'আমাদের বিজ্ঞাপনের নিয়ম ভঙ্গ করায় "{listing_title}" সরানো হয়েছে: {reason} ভুল মনে হলে সহায়তায় যোগাযোগ করুন।');`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM notify.notifications WHERE template_code = ANY($1) AND template_version = 1;
       DELETE FROM notify.templates WHERE code = ANY($1) AND version = 1;`.replace(/\$1/g, `'{${CODES.join(',')}}'`),
    );
  }
}
