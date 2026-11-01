import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { decryptField } from '../crypto/field-crypto';
import { checkTotp, hashRecoveryCode } from '../crypto/totp';

// The second factor (FR-ACC-06; Unit 1 section 6.2): a TOTP code within one step of now, never a step already
// used, or one of the unused recovery codes. Used by sign-in, step-up and a password reset with MFA on.
@Injectable()
export class SecondFactorService {
  constructor(
    private readonly db: DataSource,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
  ) {}

  /** True if the user has a confirmed TOTP factor. */
  async hasTotp(userId: string): Promise<boolean> {
    const [f] = await this.db.query(
      `SELECT 1 FROM identity.totp_factors WHERE user_id = $1 AND removed_at IS NULL AND confirmed_at IS NOT NULL`,
      [userId],
    );
    return Boolean(f);
  }

  /** 'totp' or 'recovery' if the user's code is accepted (and now used up), else null. */
  async check(userId: string, code: string, now: Date): Promise<'totp' | 'recovery' | null> {
    return this.checkFactor('user_id', userId, code, now, true);
  }

  /** SEC-AUTH-07: a staff member's TOTP code. Staff have no recovery codes; a lost authenticator is reset by four-eyes. */
  async checkStaff(staffId: string, code: string, now: Date): Promise<boolean> {
    return (await this.checkFactor('staff_id', staffId, code, now, false)) === 'totp';
  }

  /** Checks a code against a factor that is not confirmed yet (enrolment), and confirms it. */
  async confirmStaffEnrolment(staffId: string, code: string, now: Date): Promise<boolean> {
    const [f] = await this.db.query(
      `SELECT id, secret_enc FROM identity.totp_factors WHERE staff_id = $1 AND removed_at IS NULL AND confirmed_at IS NULL`,
      [staffId],
    );
    if (!f) return false;
    const step = checkTotp(this.secretOf(f), code, now);
    if (step === null) return false;
    await this.db.query(`UPDATE identity.totp_factors SET confirmed_at = $2, last_used_step = $3 WHERE id = $1`, [f.id, now, step]);
    return true;
  }

  private secretOf(f: { id: string; secret_enc: Buffer }): string {
    return decryptField(this.config.keys.field, f.secret_enc, { table: 'totp_factors', column: 'secret_enc', rowId: f.id }).toString('utf8');
  }

  private async checkFactor(column: 'user_id' | 'staff_id', id: string, code: string, now: Date, recovery: boolean): Promise<'totp' | 'recovery' | null> {
    const [f] = await this.db.query(
      `SELECT id, secret_enc FROM identity.totp_factors
       WHERE ${column} = $1 AND removed_at IS NULL AND confirmed_at IS NOT NULL`,
      [id],
    );
    if (!f) return null;
    if (/^\d{6}$/.test(code)) {
      const step = checkTotp(this.secretOf(f), code, now);
      if (step === null) return null;
      // Only a step later than the last one used is accepted, so a code cannot be replayed.
      const used = await this.db.query(
        `UPDATE identity.totp_factors SET last_used_step = $2 WHERE id = $1 AND (last_used_step IS NULL OR last_used_step < $2) RETURNING id`,
        [f.id, step],
      );
      return (Array.isArray(used[0]) ? used[0] : used).length > 0 ? 'totp' : null;
    }
    if (!recovery) return null;
    const used = await this.db.query(
      `UPDATE identity.recovery_codes SET used_at = $3 WHERE totp_factor_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
      [f.id, hashRecoveryCode(code), now],
    );
    return (Array.isArray(used[0]) ? used[0] : used).length > 0 ? 'recovery' : null;
  }
}
