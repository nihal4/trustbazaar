import { Inject, Injectable } from '@nestjs/common';
import { domainToASCII } from 'url';
import { promises as dns } from 'dns';
import type Redis from 'ioredis';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { REDIS } from '../../../kernel/redis.provider';
import { normaliseLogin } from './signin.service';

// The check before the password is asked (U10-25; FR-ACC-13): is what was typed a mobile number or an e-mail address at all, and can the e-mail's domain
// receive mail (an MX record)? It never reads or writes an account, so it says nothing about who has one (SEC-AUTH-05), and a typing slip such as 'nihal@examle.com' is
// caught before the sign-in is tried. A lookup that cannot be answered (the resolver is down, a time-out) lets the sign-in go on.
export type DomainState = 'yes' | 'no' | 'unknown';
export const DOMAIN_RESOLVER = Symbol('DOMAIN_RESOLVER');
export interface DomainResolver {
  exists(domain: string): Promise<DomainState>;
}

const LOOKUP_MS = 2500;
const NOT_THERE = new Set(['ENOTFOUND', 'ENODATA', 'ESERVFAIL', 'NXDOMAIN']);

/**
 * The domain can receive mail if it publishes an MX record with a real host. An address record alone is not enough (RFC 5321 allows that fallback, but a
 * parked or typed-by-mistake domain such as examle.com has one and takes no mail), and the null MX of RFC 7505 (a host of '' or '.') says the domain takes
 * none. Only a clear answer says no; a failure to look it up says 'unknown'.
 */
@Injectable()
export class DnsDomainResolver implements DomainResolver {
  async exists(domain: string): Promise<DomainState> {
    const look = async (): Promise<DomainState> => {
      try {
        const mx = await dns.resolveMx(domain);
        return mx.some((r) => r.exchange !== '' && r.exchange !== '.') ? 'yes' : 'no';
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? '';
        return NOT_THERE.has(code) ? 'no' : 'unknown';
      }
    };
    return Promise.race([look(), new Promise<DomainState>((r) => setTimeout(() => r('unknown'), LOOKUP_MS).unref())]);
  }
}

export type LoginCheck = { ok: true } | { ok: false; reason: 'format' | 'domain' };

@Injectable()
export class LoginCheckService {
  constructor(
    @Inject(DOMAIN_RESOLVER) private readonly resolver: DomainResolver,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(TB_CONFIG) private readonly config?: Pick<TbConfig, 'emailMode'>,
  ) {}

  async check(login: string): Promise<LoginCheck> {
    const a = normaliseLogin(login);
    if (!a) return { ok: false, reason: 'format' };
    if ('phone' in a) return { ok: true };
    const domain = domainToASCII(a.email.split('@')[1] ?? '').toLowerCase();
    const labels = domain.split('.');
    if (
      !domain ||
      labels.length < 2 ||
      !/^[a-z0-9.-]+$/.test(domain) ||
      !/^[a-z]{2,}$/.test(labels[labels.length - 1]) ||
      labels.some((l) => l.length === 0 || l.length > 63 || l.startsWith('-') || l.endsWith('-'))
    )
      return { ok: false, reason: 'format' };
    // while no mail is really sent (EMAIL_MODE=log: the development and demonstration set-ups), whether the domain can receive mail does not matter, and
    // the reserved .test domain the demonstration accounts use never could
    if (this.config?.emailMode === 'log' && domain.endsWith('.test')) return { ok: true };
    const key = `dns:mail-domain:mx:${domain}`;
    let state = (await this.redis.get(key)) as DomainState | null;
    if (!state) {
      state = await this.resolver.exists(domain);
      // what is known is kept: a domain that exists for six hours, one that does not for fifteen minutes (it may be registered soon); 'unknown' is not kept
      if (state === 'yes') await this.redis.set(key, 'yes', 'EX', 6 * 3600);
      else if (state === 'no') await this.redis.set(key, 'no', 'EX', 15 * 60);
    }
    return state === 'no' ? { ok: false, reason: 'domain' } : { ok: true };
  }
}
