import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, U6-03 (Decisions log, 2026-11-02). Runs as tb_owner (SEC-INF-03).
//   Operators remove detection terms (DELETE /staff/chat/detection-terms, section 3.1), so the application role may
//   delete rows of chat.detection_terms. docs/design/sql/06_chat_notifications.sql holds the same grant; this
//   migration brings a database migrated before it to the same rights. Messages keep the flags they were given.
export class ChatDetectionTermDelete1793491200012 implements MigrationInterface {
  name = 'ChatDetectionTermDelete1793491200012';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`GRANT DELETE ON chat.detection_terms TO tb_app`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`REVOKE DELETE ON chat.detection_terms FROM tb_app`);
  }
}
