import type { Policy } from '../../../kernel/http/policies';

// Unit 1 section 7.1, and I-51: staff sessions use their own cookies, so a staff session and a user
// session in one browser do not overwrite each other.
export const USER_COOKIES = { access: '__Host-tb_at', csrf: '__Host-tb_csrf' } as const;
export const STAFF_COOKIES = { access: '__Host-tb_sat', csrf: '__Host-tb_scsrf' } as const;
export type CookieSet = typeof USER_COOKIES | typeof STAFF_COOKIES;

export const cookiesFor = (policy: Policy | undefined): CookieSet => (policy?.kind === 'staff' ? STAFF_COOKIES : USER_COOKIES);
