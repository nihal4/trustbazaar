import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, for Unit 5's U5-03 (I-32; Decisions log, 2026-11-15). Runs as tb_owner (SEC-INF-03).
//   The seller's notice that a game-account order is paid and the login details are due within {hours} hours (CP-22),
//   and the buyer's notice that they were delivered, with the hours left to take the account over (CP-23). Sent by
//   Unit 5 through Unit 6's Notifier, since the events carry neither party. In the app and by e-mail (category
//   transaction). The texts are a draft for the team's review; a corrected text is a new version, never an edit here.
const CODES = ['game.credentials_requested', 'game.credentials_delivered'];

export class GameHandoverTemplates1793491200023 implements MigrationInterface {
  name = 'GameHandoverTemplates1793491200023';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(String.raw`
INSERT INTO notify.templates (code, version, category, channels, allowed_params, title_en, title_bn, body_en, body_bn) VALUES
 ('game.credentials_requested', 1, 'transaction', '{email}', '{listing_title,hours}',
  'Send the login details', 'লগইন তথ্য পাঠান',
  'The buyer paid for "{listing_title}". Send the login details through the sealed handover on the order within {hours} hours, or the buyer is refunded.',
  '"{listing_title}"-এর ক্রেতা টাকা পরিশোধ করেছেন। {hours} ঘণ্টার মধ্যে অর্ডারের সিল করা হস্তান্তরের মাধ্যমে লগইন তথ্য পাঠান, নইলে ক্রেতাকে টাকা ফেরত দেওয়া হবে।'),
 ('game.credentials_delivered', 1, 'transaction', '{email}', '{listing_title,hours}',
  'The login details are ready', 'লগইন তথ্য প্রস্তুত',
  'The seller sent the login details for "{listing_title}". Open them in the same browser you paid with, and take the account over within {hours} hours.',
  '"{listing_title}"-এর লগইন তথ্য বিক্রেতা পাঠিয়েছেন। যে ব্রাউজারে টাকা দিয়েছেন সেখানেই খুলুন, এবং {hours} ঘণ্টার মধ্যে অ্যাকাউন্টের নিয়ন্ত্রণ নিন।');`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM notify.notifications WHERE template_code = ANY($1) AND template_version = 1;
       DELETE FROM notify.templates WHERE code = ANY($1) AND version = 1;`.replace(/\$1/g, `'{${CODES.join(',')}}'`),
    );
  }
}
