import type { DataSource } from 'typeorm';

// The data export (docs/design/07_disputes_trust_staff.pdf section 10; FR-PRV-03; U7-11). Each unit offers one
// DataExportSource through its ports; Unit 7's export job asks every source for the user's data and writes one JSON
// file in a ZIP. A source returns named lists of plain JSON objects. Hashes, encrypted fields, internal keys and
// staff identities are left out; credentials, KYC images and evidence files are never included.
export interface DataExportSource {
  /** The section of the export, such as 'account' or 'orders'. */
  readonly section: string;
  exportFor(userId: string): Promise<Record<string, unknown[]>>;
}

/**
 * Runs each named query with the user's id as $1. Each query selects one jsonb column named r; to_jsonb(t) minus the
 * columns to leave out is the usual form.
 */
export async function collectRows(db: Pick<DataSource, 'query'>, queries: Record<string, string>, userId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [name, sql] of Object.entries(queries)) {
    out[name] = ((await db.query(sql, [userId])) as { r: unknown }[]).map((row) => row.r);
  }
  return out;
}
