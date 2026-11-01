// Reading a problem document (DC-3): its name, and the field errors in either of the backend's two
// shapes, [{field, reason}] from a service or ["field must be ..."] from request validation.
import { ApiError } from '../lib/api.js';

/** The problem's name, from its type `/problems/<name>`; null for other errors. */
export function problemName(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const m = /\/problems\/([a-z0-9-]+)$/.exec(error.type ?? '');
  return m ? m[1] : null;
}

export interface FieldError {
  field: string;
  reason: string;
}

export function fieldErrors(error: unknown): FieldError[] {
  if (!(error instanceof ApiError) || !Array.isArray(error.errors)) return [];
  return error.errors.flatMap((e: unknown): FieldError[] => {
    if (typeof e === 'string') {
      const field = /^([A-Za-z]+)\b/.exec(e)?.[1];
      return field ? [{ field, reason: 'invalid' }] : [];
    }
    if (e && typeof e === 'object' && typeof (e as FieldError).field === 'string') {
      const { field, reason } = e as FieldError;
      return [{ field, reason: typeof reason === 'string' ? reason : 'invalid' }];
    }
    return [];
  });
}

export const isApiError = (e: unknown, status?: number): e is ApiError =>
  e instanceof ApiError && (status === undefined || e.status === status);
