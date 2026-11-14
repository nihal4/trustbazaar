import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, for Unit 7's U7-03 (Decisions log, 2026-11-14). Runs as tb_owner (SEC-INF-03).
//   The notices of a dispute's opening and withdrawal (FR-DSP-03), sent by Unit 7 through Unit 6's Notifier: the seller
//   learns that a dispute was opened and how long they have to respond (CP-20, {hours}); the buyer that the payment is
//   on hold; the seller that the buyer withdrew it. In the app and by e-mail (category transaction; never SMS). Their
//   texts are a draft for the team's review; a corrected text is a new version, never an edit of this migration.
const CODES = ['dispute.opened_seller', 'dispute.opened_buyer', 'dispute.withdrawn_seller'];

export class DisputeNoticeTemplates1793491200017 implements MigrationInterface {
  name = 'DisputeNoticeTemplates1793491200017';

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
 ('dispute.opened_seller', 1, 'transaction', '{email}', '{listing_title,hours}',
  'A buyer opened a dispute', 'একজন ক্রেতা অভিযোগ করেছেন',
  'The buyer of "{listing_title}" opened a dispute. Respond within {hours} hours with your side and any evidence; after that our team decides on what it has. The payment stays on hold until then.',
  '"{listing_title}"-এর ক্রেতা একটি অভিযোগ করেছেন। {hours} ঘণ্টার মধ্যে আপনার বক্তব্য ও প্রমাণ দিন; এরপর আমাদের দল যা আছে তার ভিত্তিতে সিদ্ধান্ত নেবে। ততক্ষণ পেমেন্ট আটকে থাকবে।'),
 ('dispute.opened_buyer', 1, 'transaction', '{email}', '{listing_title}',
  'Your dispute was opened', 'আপনার অভিযোগ গ্রহণ করা হয়েছে',
  'Your dispute about "{listing_title}" was opened. The payment is on hold until it is resolved; you can add statements and evidence in the app.',
  '"{listing_title}" নিয়ে আপনার অভিযোগ গ্রহণ করা হয়েছে। সমাধান না হওয়া পর্যন্ত পেমেন্ট আটকে থাকবে; অ্যাপে আপনি বক্তব্য ও প্রমাণ যোগ করতে পারবেন।'),
 ('dispute.withdrawn_seller', 1, 'transaction', '{email}', '{listing_title}',
  'The buyer withdrew the dispute', 'ক্রেতা অভিযোগ তুলে নিয়েছেন',
  'The buyer withdrew the dispute about "{listing_title}". The order continues as normal.',
  '"{listing_title}" নিয়ে ক্রেতা তাঁর অভিযোগ তুলে নিয়েছেন। অর্ডারটি স্বাভাবিকভাবে চলবে।');
`;
