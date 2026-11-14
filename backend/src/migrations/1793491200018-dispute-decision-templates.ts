import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, for Unit 7's U7-03 (Decisions log, 2026-11-14). Runs as tb_owner (SEC-INF-03).
//   The notices of a dispute's decision (FR-DSP-07: both parties; the outcome and the operator's reason are in the
//   dispute's view, not in the notice) and of the operator's request for more information (FR-DSP-09: the seller, with
//   DV-47's {hours}). Sent by Unit 7 through Unit 6's Notifier. In the app and by e-mail (category transaction). Their
//   texts are a draft for the team's review; a corrected text is a new version, never an edit of this migration.
const CODES = ['dispute.decided', 'dispute.info_requested'];

export class DisputeDecisionTemplates1793491200018 implements MigrationInterface {
  name = 'DisputeDecisionTemplates1793491200018';

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
 ('dispute.decided', 1, 'transaction', '{email}', '{listing_title}',
  'The dispute was decided', 'অভিযোগের সিদ্ধান্ত হয়েছে',
  'Our team decided the dispute about "{listing_title}". Open the dispute in the app to see the outcome and the reason.',
  'আমাদের দল "{listing_title}" নিয়ে অভিযোগের সিদ্ধান্ত নিয়েছে। ফলাফল ও কারণ দেখতে অ্যাপে অভিযোগটি খুলুন।'),
 ('dispute.info_requested', 1, 'transaction', '{email}', '{listing_title,hours}',
  'More information needed for a dispute', 'অভিযোগের জন্য আরও তথ্য প্রয়োজন',
  'Our team needs more information from you about the dispute on "{listing_title}". Please answer in the app within {hours} hours.',
  '"{listing_title}" নিয়ে অভিযোগের বিষয়ে আমাদের দলের আপনার কাছ থেকে আরও তথ্য প্রয়োজন। অনুগ্রহ করে {hours} ঘণ্টার মধ্যে অ্যাপে উত্তর দিন।');
`;
