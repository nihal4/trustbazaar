// The signed-in user's own account: GET /me (U1-13; Decisions log, U1-13 and U8-02). This is the one
// place that reads it; screens use useMe(). GET /me is also lib/api.js's refresh probe (I-51 c).
import { useQuery } from '@tanstack/react-query';
import { useApi, type Api } from './api';
import { FRESHNESS } from './query';

export type KycStatus = 'unsubmitted' | 'pending_review' | 'verified' | 'rejected' | 'revoked';
export type AccountStatus = 'active' | 'suspended' | 'closed';

export interface Me {
  id: string;
  displayName: string;
  /** the last three digits only, `***678` (SEC-DAT-07) */
  phoneMasked: string | null;
  email: string | null;
  emailVerified: boolean;
  kycStatus: KycStatus;
  accountStatus: AccountStatus;
  mfaEnabled: boolean;
}

export const ME_KEY = ['me'] as const;

export function fetchMe(api: Api, signal?: AbortSignal): Promise<Me> {
  return api.get('/me', { signal });
}

/**
 * The account, or an error when nobody is signed in (401) or the endpoint is not there yet (404).
 * Section 4.3: fresh only until the next read; refetched after sign-in, step-up and KYC submission.
 */
export function useMe() {
  const api = useApi();
  return useQuery({
    queryKey: ME_KEY,
    queryFn: ({ signal }) => fetchMe(api, signal),
    staleTime: FRESHNESS.account,
    retry: false,
  });
}
