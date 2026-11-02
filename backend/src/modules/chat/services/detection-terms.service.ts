import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort } from '../../identity/ports';

// The detection terms (docs/design/06_chat_notifications.pdf sections 3.1 and 6.4; FR-CHT-07, FR-GAM-20; U6-03).
// Operators add and remove terms; each change is audited (DC-8). A term is stored lower case and NFC (term_normalised),
// as chat.detect compares. Removing a term changes no message already flagged: flags are kept with the message.

export const FLAGS = ['payment_phrase', 'off_platform_app', 'credentials'] as const;
export type DetectionFlag = (typeof FLAGS)[number];
export const MAX_TERM = 60;

export interface DetectionTermView {
  term: string;
  flag: DetectionFlag;
  addedAt: string;
}

export const normaliseTerm = (term: string): string => term.normalize('NFC').toLowerCase().normalize('NFC').trim().replace(/\s+/g, ' ');

@Injectable()
export class DetectionTermsService {
  constructor(
    private readonly db: DataSource,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
  ) {}

  /** GET /staff/chat/detection-terms: newest first (Decisions log, U6-03). */
  async list(): Promise<{ items: DetectionTermView[] }> {
    const rows = (await this.db.query(`SELECT term, flag, added_at FROM chat.detection_terms ORDER BY added_at DESC, id DESC`)) as {
      term: string; flag: DetectionFlag; added_at: Date;
    }[];
    return { items: rows.map((r) => ({ term: r.term, flag: r.flag, addedAt: r.added_at.toISOString() })) };
  }

  /** POST: a term already listed is a conflict, whatever its flag. */
  async add(staffId: string, rawTerm: string, flag: DetectionFlag): Promise<DetectionTermView> {
    const term = normaliseTerm(rawTerm);
    if (term.length < 2 || term.length > MAX_TERM) throw new Problem('validation-failed', { errors: [{ field: 'term', reason: 'length' }] });
    try {
      return await this.db.transaction(async (m) => {
        const [r] = (await m.query(
          `INSERT INTO chat.detection_terms (term, flag, added_by) VALUES ($1, $2, $3) RETURNING id, added_at`, [term, flag, staffId],
        )) as { id: number; added_at: Date }[];
        await this.audit.record({
          actorType: 'staff', actorId: staffId, action: 'chat.detection_term.added', objectType: 'detection_term', objectId: null, // the term's id is an integer; the audit's object id is a uuid
          after: { id: r.id, term, flag },
        }, m);
        return { term, flag, addedAt: r.added_at.toISOString() };
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23505') {
        throw new Problem('validation-failed', { errors: [{ field: 'term', reason: 'exists' }] });
      }
      throw err;
    }
  }

  /** DELETE ?term=: removes it from detection from now on. */
  async remove(staffId: string, rawTerm: string): Promise<void> {
    const term = normaliseTerm(rawTerm);
    await this.db.transaction(async (m) => {
      const res = (await m.query(`DELETE FROM chat.detection_terms WHERE term = $1 RETURNING id, flag`, [term])) as unknown[];
      const [row] = (Array.isArray(res[0]) ? res[0] : res) as { id: number; flag: string }[]; // TypeORM: [rows, count] for DELETE
      if (!row) throw new Problem('not-found');
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'chat.detection_term.removed', objectType: 'detection_term', objectId: null,
        before: { id: row.id, term, flag: row.flag },
      }, m);
    });
  }
}
