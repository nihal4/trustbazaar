import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { StepUpAction } from '../../../kernel/http/policies';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';
import { NOTIFICATIONS, NotificationPort } from '../adapters/notifications';
import { generateOtp } from '../crypto/otp';
import { hashGrant, STEP_UP_SECONDS, stepUpKey } from '../security/step-up';
import { AuditService } from './audit.service';
import { OtpService } from './otp.service';
import { SecondFactorService } from './second-factor.service';
import { RequestContext } from './session.service';

// Step-up (Unit 1 section 6.3; SEC-AUTH-08). start names one action. With TOTP, the authenticator code is the
// challenge and nothing is sent; otherwise an SMS code is bound to this session and this action. verify
// returns a single-use grant for DV-2; only its hash is kept, under stepup:{sid}:{action}, and StepUpGuard
// consumes it with GETDEL.
export type StepUpStart = { method: 'totp' } | { method: 'sms'; resendAt: string };

@Injectable()
export class StepUpService {
  constructor(
    private readonly db: DataSource,
    private readonly otp: OtpService,
    private readonly secondFactor: SecondFactorService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(NOTIFICATIONS) private readonly notify: NotificationPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async start(userId: string, sessionId: string, action: StepUpAction): Promise<StepUpStart> {
    if (await this.secondFactor.hasTotp(userId)) return { method: 'totp' };
    const phone = await this.phoneOf(userId);
    await this.otp.countSend(phone);
    const code = generateOtp();
    const cp05 = await this.otp.cp05();
    await this.db.transaction((m) => this.otp.issue(m, { purpose: 'step_up', phone, userId, boundTo: `${sessionId}:${action}` }, code));
    await this.notify.sendSms(phone, 'otp_step_up', { code, minutes: String(cp05.otpValidityMinutes) });
    return { method: 'sms', resendAt: new Date(this.clock.now().getTime() + 60_000).toISOString() };
  }

  async verify(userId: string, sessionId: string, action: StepUpAction, code: string, ctx: RequestContext): Promise<{ grant: string; expiresInSeconds: number }> {
    await this.otp.countEntry(`user:${userId}`);
    const ok = await this.db.transaction(async (m) => {
      let accepted: boolean;
      if (await this.secondFactor.hasTotp(userId)) {
        accepted = (await this.secondFactor.check(userId, code, this.clock.now())) !== null;
      } else {
        const r = await this.otp.consume(m, `purpose = 'step_up' AND user_id = $1 AND bound_to = $2`, [userId, `${sessionId}:${action}`], code);
        if (r.kind === 'expired') throw new Problem('otp-expired');
        accepted = r.kind === 'ok';
      }
      await this.audit.record(m, {
        actorType: 'user', actorId: userId, action: accepted ? 'identity.step_up.granted' : 'identity.step_up.failed',
        objectType: 'session', objectId: sessionId, reason: action, sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
      return accepted;
    });
    if (!ok) throw new Problem('otp-failed');
    const grant = randomBytes(32).toString('base64url');
    await this.redis.set(stepUpKey(sessionId, action), hashGrant(grant), 'EX', STEP_UP_SECONDS);
    return { grant, expiresInSeconds: STEP_UP_SECONDS };
  }

  private async phoneOf(userId: string): Promise<string> {
    const [u] = await this.db.query(`SELECT phone_e164 FROM identity.users WHERE id = $1`, [userId]);
    if (!u?.phone_e164) throw new Problem('forbidden');
    return u.phone_e164;
  }
}
