import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, for Unit 7's U7-07 (Decisions log, 2026-11-14). Runs as tb_owner (SEC-INF-03).
//   The user's notice of a lawful disclosure (FR-PRV-06), sent by Unit 7 through Unit 6's Notifier after a second staff
//   member approved it, unless the law forbids telling them (then the reason is recorded instead). It names the
//   authority, not the scope. In the app and by e-mail (category account). The texts are a draft for the team's review;
//   a corrected text is a new version, never an edit of this migration.
export class DisclosureNoticeTemplate1793491200020 implements MigrationInterface {
  name = 'DisclosureNoticeTemplate1793491200020';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(String.raw`
INSERT INTO notify.templates (code, version, category, channels, allowed_params, title_en, title_bn, body_en, body_bn) VALUES
 ('privacy.disclosure_notice', 1, 'account', '{email}', '{authority}',
  'Your data was shared with an authority', 'আপনার তথ্য একটি কর্তৃপক্ষকে দেওয়া হয়েছে',
  'In response to a lawful request, we shared some of your TrustBazaar account data with {authority}. Contact support if you have questions.',
  'একটি আইনানুগ অনুরোধের প্রেক্ষিতে আমরা আপনার TrustBazaar অ্যাকাউন্টের কিছু তথ্য {authority}-কে দিয়েছি। কোনো প্রশ্ন থাকলে সাপোর্টে যোগাযোগ করুন।');`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM notify.notifications WHERE template_code = 'privacy.disclosure_notice' AND template_version = 1;
      DELETE FROM notify.templates WHERE code = 'privacy.disclosure_notice' AND version = 1;`);
  }
}
