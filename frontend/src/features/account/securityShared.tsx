// What the parts of the security page share: the sessions query key and page size, the summary of a session, and the call that runs after a step-up.
import { StepUpCancelled } from '../../shared/stepUp';

export interface SessionSummary {
  id: string;
  current: boolean;
  device: string | null;
  approxLocation: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export const SESSIONS_KEY = ['auth', 'sessions'] as const;

export const SESSIONS_SHOWN = 2;

/** Runs a change that needs step-up; a cancelled dialog is not an error. */
export async function withStepUp<R>(call: () => Promise<R>): Promise<R | 'cancelled'> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof StepUpCancelled) return 'cancelled';
    throw e;
  }
}
