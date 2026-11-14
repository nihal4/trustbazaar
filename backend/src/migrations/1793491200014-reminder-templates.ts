import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, U6-06 (Decisions log, 2026-11-14). Runs as tb_owner (SEC-INF-03).
//   The deadline reminders' templates (FR-NTF-07, CP-38): in the app, and by e-mail unless the person switched
//   reminders off (category reminder; never SMS, FR-NTF-05). One per deadline kind of Unit 2's orders; Unit 5's
//   takeover window and protection period come with Unit 5. {hours} is the lead (24 or 2). No reminder carries a
//   code, key or credential (section 3.4). Their texts are a draft for the team's review; a corrected text is a new
//   version, never an edit of this migration.
const CODES = ['reminder.payment_window', 'reminder.meetup_handover', 'reminder.courier_pickup', 'reminder.credential_delivery', 'reminder.dispute_window'];

export class ReminderTemplates1793491200014 implements MigrationInterface {
  name = 'ReminderTemplates1793491200014';

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
 ('reminder.payment_window', 1, 'reminder', '{email}', '{listing_title,hours}',
  'Payment due soon', 'পেমেন্টের সময় শেষ হচ্ছে',
  'Pay for "{listing_title}" within {hours} hours, or the order is cancelled.',
  '"{listing_title}"-এর পেমেন্ট {hours} ঘণ্টার মধ্যে করুন, নইলে অর্ডারটি বাতিল হয়ে যাবে।'),
 ('reminder.meetup_handover', 1, 'reminder', '{email}', '{listing_title,hours}',
  'Handover due soon', 'হস্তান্তরের সময় ঘনিয়ে আসছে',
  'The handover of "{listing_title}" is due within {hours} hours. If you have not agreed a meeting place yet, do it in the app.',
  '"{listing_title}" হস্তান্তরের শেষ সময় আর {hours} ঘণ্টা। দেখা করার জায়গা এখনো ঠিক না হলে অ্যাপে ঠিক করে নিন।'),
 ('reminder.courier_pickup', 1, 'reminder', '{email}', '{listing_title,hours}',
  'Courier pickup due soon', 'কুরিয়ার পিকআপের সময় ঘনিয়ে আসছে',
  'The courier must pick up "{listing_title}" within {hours} hours. Have the parcel ready, or the buyer is refunded.',
  '"{listing_title}" কুরিয়ারের কাছে তুলে দেওয়ার শেষ সময় আর {hours} ঘণ্টা। পার্সেল তৈরি রাখুন, নইলে ক্রেতাকে টাকা ফেরত দেওয়া হবে।'),
 ('reminder.credential_delivery', 1, 'reminder', '{email}', '{listing_title,hours}',
  'Account handover due soon', 'অ্যাকাউন্ট হস্তান্তরের সময় ঘনিয়ে আসছে',
  'Hand over the account "{listing_title}" within {hours} hours through the sealed handover in the app, or the buyer is refunded.',
  '"{listing_title}" অ্যাকাউন্টটি {hours} ঘণ্টার মধ্যে অ্যাপের সিল করা হস্তান্তরের মাধ্যমে দিন, নইলে ক্রেতাকে টাকা ফেরত দেওয়া হবে।'),
 ('reminder.dispute_window', 1, 'reminder', '{email}', '{listing_title,hours}',
  'Time to report a problem ends soon', 'অভিযোগ জানানোর সময় শেষ হচ্ছে',
  'If something is wrong with "{listing_title}", you can open a dispute for {hours} more hours. After that the payment is released to the seller.',
  '"{listing_title}" নিয়ে কোনো সমস্যা থাকলে আর {hours} ঘণ্টা অভিযোগ জানাতে পারবেন। এরপর টাকা বিক্রেতাকে দিয়ে দেওয়া হবে।');
`;
