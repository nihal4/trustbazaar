import { MigrationInterface, QueryRunner } from 'typeorm';

// Units 7 and 6, U7-11 (Decisions log, 2026-11-17; agreed with the user). Runs as tb_owner (SEC-INF-03).
//   FR-PRV-03: staff.export_requests.file_key holds a FileVault key (about 200 characters), so it is widened to 400;
//   docs/design/sql/07_disputes_trust_staff.sql holds the result. The notice that an export is ready is Unit 6's
//   template privacy.export_ready (in the app and by e-mail; a draft text for the team's review).
export class DataExport1793491200032 implements MigrationInterface {
  name = 'DataExport1793491200032';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE staff.export_requests ALTER COLUMN file_key TYPE varchar(400)`);
    await q.query(String.raw`
INSERT INTO notify.templates (code, version, category, channels, allowed_params, title_en, title_bn, body_en, body_bn) VALUES
 ('privacy.export_ready', 1, 'account', '{email}', '{expires_on}',
  'Your copy of your data is ready', 'আপনার তথ্যের কপি প্রস্তুত',
  'The copy of your TrustBazaar data you asked for is ready. Download it from Settings, Privacy before {expires_on}; after that it is deleted. Identity-document images are not included; ask us if you need them.',
  'আপনার অনুরোধ করা TrustBazaar তথ্যের কপি প্রস্তুত। {expires_on} এর আগে সেটিংস, গোপনীয়তা থেকে ডাউনলোড করুন; এরপর এটি মুছে ফেলা হবে। পরিচয়পত্রের ছবি এতে নেই; প্রয়োজন হলে আমাদের জানান।');`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM notify.notifications WHERE template_code = 'privacy.export_ready' AND template_version = 1;
      DELETE FROM notify.templates WHERE code = 'privacy.export_ready' AND version = 1;
      ALTER TABLE staff.export_requests ALTER COLUMN file_key TYPE varchar(80);`);
  }
}
