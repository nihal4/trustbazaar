import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, for Unit 5's U5-04 (I-32; Decisions log, 2026-11-15). Runs as tb_owner (SEC-INF-03).
//   The seller's notice of the buyer's one re-key (FR-GAM-12): seal again for the new key within {hours} hours (DV-37);
//   both parties' notice that the takeover is complete and the protection period of {days} days has begun (FR-GAM-16).
//   Sent by Unit 5 through Unit 6's Notifier. In the app and by e-mail (category transaction). The texts are a draft
//   for the team's review; a corrected text is a new version, never an edit of this migration.
const CODES = ['game.rekey_requested', 'game.takeover_completed'];

export class GameTakeoverTemplates1793491200024 implements MigrationInterface {
  name = 'GameTakeoverTemplates1793491200024';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(String.raw`
INSERT INTO notify.templates (code, version, category, channels, allowed_params, title_en, title_bn, body_en, body_bn) VALUES
 ('game.rekey_requested', 1, 'transaction', '{email}', '{listing_title,hours}',
  'Send the login details again', 'লগইন তথ্য আবার পাঠান',
  'The buyer of "{listing_title}" lost access to the details you sent and set up a new key. Send the login details again through the sealed handover within {hours} hours, or the case goes to our team.',
  '"{listing_title}"-এর ক্রেতা আপনার পাঠানো তথ্য খোলার সুযোগ হারিয়েছেন এবং নতুন কী তৈরি করেছেন। {hours} ঘণ্টার মধ্যে সিল করা হস্তান্তরের মাধ্যমে লগইন তথ্য আবার পাঠান, নইলে বিষয়টি আমাদের দলের কাছে যাবে।'),
 ('game.takeover_completed', 1, 'transaction', '{email}', '{listing_title,days}',
  'The account has changed hands', 'অ্যাকাউন্টের হাতবদল সম্পন্ন',
  'The takeover of "{listing_title}" is complete. The payment is held for {days} more days of protection; if the seller takes the account back in that time, the buyer can open a dispute.',
  '"{listing_title}"-এর হাতবদল সম্পন্ন হয়েছে। সুরক্ষার জন্য আরও {days} দিন পেমেন্ট আটকে থাকবে; এই সময়ে বিক্রেতা অ্যাকাউন্ট ফিরিয়ে নিলে ক্রেতা অভিযোগ করতে পারবেন।');`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM notify.notifications WHERE template_code = ANY($1) AND template_version = 1;
       DELETE FROM notify.templates WHERE code = ANY($1) AND version = 1;`.replace(/\$1/g, `'{${CODES.join(',')}}'`),
    );
  }
}
