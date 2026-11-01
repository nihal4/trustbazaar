import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, U6-02 (Decisions log, 2026-11-02). Runs as tb_owner (SEC-INF-03).
//   chat.messages.image_key holds Unit 1's FileVault key (`v1.<purpose>.<file id>.<name>.<wrapped data key>`, about
//   165 characters; Decisions log, U1-08), so it is varchar(300), not 80. docs/design/sql/06_chat_notifications.sql
//   holds the result; this migration brings a database migrated before it to the same schema.
//   The chat notice (section 7.4): in the app for every new message, by e-mail only when the recipient is not
//   connected and had no chat e-mail for the thread in DV-41 (15 minutes). It never carries the message's text.
//   The template's shape is the one of the design's SQL tests; its texts are a draft for the team's review.
export class ChatImageKeyTemplate1793491200011 implements MigrationInterface {
  name = 'ChatImageKeyTemplate1793491200011';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(SQL);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM notify.notifications WHERE template_code = 'chat.new_message' AND template_version = 1;
      DELETE FROM notify.templates WHERE code = 'chat.new_message' AND version = 1;
      ALTER TABLE chat.messages ALTER COLUMN image_key TYPE varchar(80);`);
  }
}

const SQL = String.raw`
ALTER TABLE chat.messages ALTER COLUMN image_key TYPE varchar(300);

INSERT INTO notify.templates (code, version, category, channels, allowed_params, title_en, title_bn, body_en, body_bn) VALUES
 ('chat.new_message', 1, 'chat', '{email}', '{listing_title,sender_name}',
  'New message about {listing_title}', '{listing_title} নিয়ে নতুন বার্তা',
  'You have a new message from {sender_name} about {listing_title}. Open TrustBazaar to read it and reply. Pay only through the app: payments outside it are not protected.',
  '{listing_title} নিয়ে {sender_name} আপনাকে একটি বার্তা পাঠিয়েছেন। পড়তে ও উত্তর দিতে TrustBazaar খুলুন। শুধু অ্যাপের মাধ্যমেই টাকা দিন: অ্যাপের বাইরের পেমেন্ট সুরক্ষিত নয়।');
`;
