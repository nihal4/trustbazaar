import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, for Unit 7's U7-04 (Decisions log, 2026-11-14). Runs as tb_owner (SEC-INF-03).
//   The notices of trust.sanction.applied, .lifted and trust.report.resolved (FR-TNS-03, FR-TNS-09): a sanction's
//   notice gives the operator's reason ({reason}, masked like other written text); the automatic selling suspension
//   after CP-47 strikes has its own text; a report's notice says only whether action was taken, never what action.
//   In the app and by e-mail (category account; never SMS, FR-NTF-05). Their texts are a draft for the team's
//   review; a corrected text is a new version, never an edit of this migration.
const CODES = [
  'trust.warning', 'trust.selling_suspended', 'trust.selling_suspended_strikes', 'trust.buying_suspended', 'trust.account_suspended',
  'trust.sanction_lifted', 'trust.report_actioned', 'trust.report_dismissed',
];

export class TrustNoticeTemplates1793491200015 implements MigrationInterface {
  name = 'TrustNoticeTemplates1793491200015';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(SQL);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM notify.notifications WHERE template_code = ANY($1) AND template_version = 1;
       DELETE FROM notify.templates WHERE code = ANY($1) AND version = 1;`.replace(/\$1/g, `'{${CODES.join(',')}}'`),
    );
  }
}

const SQL = String.raw`
INSERT INTO notify.templates (code, version, category, channels, allowed_params, title_en, title_bn, body_en, body_bn) VALUES
 ('trust.warning', 1, 'account', '{email}', '{reason}',
  'A warning about your account', 'আপনার অ্যাকাউন্ট সম্পর্কে একটি সতর্কতা',
  'We reviewed activity on your account and are giving you a warning. Reason: {reason}. Further breaches of our rules can lead to restrictions.',
  'আমরা আপনার অ্যাকাউন্টের কার্যকলাপ পর্যালোচনা করে আপনাকে সতর্ক করছি। কারণ: {reason}। আবার নিয়ম ভাঙলে আপনার অ্যাকাউন্টে বিধিনিষেধ আরোপ করা হতে পারে।'),
 ('trust.selling_suspended', 1, 'account', '{email}', '{reason}',
  'Selling is suspended on your account', 'আপনার অ্যাকাউন্টে বিক্রি স্থগিত',
  'You cannot list items for now, and your listings are hidden. Reason: {reason}. Orders already paid continue as normal.',
  'আপাতত আপনি কোনো পণ্যের বিজ্ঞাপন দিতে পারবেন না, এবং আপনার বিজ্ঞাপনগুলো লুকানো থাকবে। কারণ: {reason}। আগে পেমেন্ট হওয়া অর্ডারগুলো স্বাভাবিকভাবে চলবে।'),
 ('trust.selling_suspended_strikes', 1, 'account', '{email}', '{}',
  'Selling is suspended on your account', 'আপনার অ্যাকাউন্টে বিক্রি স্থগিত',
  'Your account has several seller strikes (cancellations after payment, missed deadlines or lost disputes), so selling is suspended until our team reviews it. Orders already paid continue as normal.',
  'আপনার অ্যাকাউন্টে বিক্রেতা হিসেবে কয়েকটি স্ট্রাইক জমা হয়েছে (পেমেন্টের পর বাতিল, সময়সীমা পার হওয়া বা হেরে যাওয়া অভিযোগ), তাই আমাদের দল পর্যালোচনা না করা পর্যন্ত বিক্রি স্থগিত থাকবে। আগে পেমেন্ট হওয়া অর্ডারগুলো স্বাভাবিকভাবে চলবে।'),
 ('trust.buying_suspended', 1, 'account', '{email}', '{reason}',
  'Buying is suspended on your account', 'আপনার অ্যাকাউন্টে কেনাকাটা স্থগিত',
  'You cannot buy or bid for now. Reason: {reason}. Orders already paid continue as normal.',
  'আপাতত আপনি কিছু কিনতে বা নিলামে দর দিতে পারবেন না। কারণ: {reason}। আগে পেমেন্ট হওয়া অর্ডারগুলো স্বাভাবিকভাবে চলবে।'),
 ('trust.account_suspended', 1, 'account', '{email}', '{reason}',
  'Your account is suspended', 'আপনার অ্যাকাউন্ট স্থগিত করা হয়েছে',
  'Your TrustBazaar account is suspended. Reason: {reason}. Contact support to know more.',
  'আপনার TrustBazaar অ্যাকাউন্ট স্থগিত করা হয়েছে। কারণ: {reason}। বিস্তারিত জানতে সাপোর্টে যোগাযোগ করুন।'),
 ('trust.sanction_lifted', 1, 'account', '{email}', '{}',
  'A restriction was lifted', 'একটি বিধিনিষেধ তুলে নেওয়া হয়েছে',
  'A restriction on your TrustBazaar account has been lifted.',
  'আপনার TrustBazaar অ্যাকাউন্টের একটি বিধিনিষেধ তুলে নেওয়া হয়েছে।'),
 ('trust.report_actioned', 1, 'account', '{email}', '{}',
  'Your report was reviewed', 'আপনার রিপোর্ট পর্যালোচনা করা হয়েছে',
  'Thank you. We reviewed your report and took action.',
  'ধন্যবাদ। আমরা আপনার রিপোর্ট পর্যালোচনা করে ব্যবস্থা নিয়েছি।'),
 ('trust.report_dismissed', 1, 'account', '{email}', '{}',
  'Your report was reviewed', 'আপনার রিপোর্ট পর্যালোচনা করা হয়েছে',
  'Thank you. We reviewed your report and found no breach of our rules.',
  'ধন্যবাদ। আমরা আপনার রিপোর্ট পর্যালোচনা করেছি এবং আমাদের নিয়মের কোনো লঙ্ঘন পাইনি।');
`;
