import { MigrationInterface, QueryRunner } from 'typeorm';

// U10-23 (Decisions log): a dispute may carry up to two videos beside its photos. disputes.evidence.mime also allows
// video/mp4 and video/webm (a QuickTime file is kept as MP4), and byte_size allows 50 MB (52428800); a photo is still
// limited to 10 MB by the service (CP-33), the per-dispute count of 10 files by the trigger. Runs as tb_owner (SEC-INF-03).
export class DisputeVideo1793491200035 implements MigrationInterface {
  name = 'DisputeVideo1793491200035';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE disputes.evidence DROP CONSTRAINT evidence_mime_check`);
    await q.query(`ALTER TABLE disputes.evidence ADD CONSTRAINT evidence_mime_check CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm'))`);
    await q.query(`ALTER TABLE disputes.evidence DROP CONSTRAINT evidence_byte_size_check`);
    await q.query(`ALTER TABLE disputes.evidence ADD CONSTRAINT evidence_byte_size_check CHECK (byte_size BETWEEN 1 AND 52428800)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE disputes.evidence DROP CONSTRAINT evidence_byte_size_check`);
    await q.query(`ALTER TABLE disputes.evidence ADD CONSTRAINT evidence_byte_size_check CHECK (byte_size BETWEEN 1 AND 10485760) NOT VALID`); // NOT VALID: rows with a video may exist
    await q.query(`ALTER TABLE disputes.evidence DROP CONSTRAINT evidence_mime_check`);
    await q.query(`ALTER TABLE disputes.evidence ADD CONSTRAINT evidence_mime_check CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')) NOT VALID`);
  }
}
