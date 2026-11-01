import { Problem } from './problems';

// Keyset cursors for "newest first" pages (created_at, id). PostgreSQL keeps timestamps to the microsecond and
// JavaScript's Date to the millisecond, so a cursor made from a Date skips the rows created within the same
// millisecond after the page's last row (found by the notifications test, U6-04). The cursor therefore carries
// the timestamp as PostgreSQL prints it: select `${cursorAt('created_at')} AS cursor_at` with the page, and
// compare with `(created_at, id) < ($n::timestamptz, $m::uuid)`.
export const cursorAt = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`).toString('base64url');
}

/** The page's position, or null for the first page; a malformed cursor is a 400 on the field `cursor`. */
export function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (cursor === undefined || cursor === '') return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!at || !id || !AT.test(at) || !ID.test(id)) throw new Problem('validation-failed', { errors: [{ field: 'cursor', reason: 'format' }] });
  return { at, id };
}
