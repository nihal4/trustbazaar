import { Controller, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../../src/kernel/http/policies';
import { registry } from '../../src/kernel/metrics/metrics';
import { submitKyc, suite } from './setup';

// SEC-LOG-05: the team is alerted on a spike in failed sign-ins, OTP send volume above normal, one staff member viewing
// many KYC records, a break in the audit hash chain, repeated webhook signature failures and any rejected escrow
// transition. Each event is a Prometheus counter on the metrics server (Unit 9 section 8.3), which the alert rules
// of the deployment watch; here each counter is checked to exist and to move when its event happens.
/** A test-only route that tries an escrow change the database forbids: an escrow that does not start held. */
@Controller('test-log-05')
class EscrowProbe {
  constructor(private readonly db: DataSource) {}
  @Public()
  @Post()
  async probe() {
    await this.db.query(`INSERT INTO orders.escrows (order_id, state, release_policy, amount_collected) VALUES (gen_random_uuid(), 'released', 'standard', 1)`);
  }
}
const s = suite([EscrowProbe]);
const value = async (name: string, labels: Record<string, string> = {}) => {
  const m = (await registry.getMetricsAsJSON()).find((x) => x.name === name);
  if (!m) return undefined;
  return (m.values as { value: number; labels: Record<string, string> }[])
    .filter((v) => Object.entries(labels).every(([k, x]) => v.labels[k] === x))
    .reduce((t, v) => t + v.value, 0);
};

describe('SEC-LOG-05 alert signals', () => {
  it('SEC-LOG-05 every event the requirement names has its counter in the scraped metrics', async () => {
    const text = await registry.metrics();
    for (const name of [
      'tb_signin_failures_total',
      'tb_otp_sent_total',
      'tb_kyc_views_total',
      'tb_audit_chain_breaks_total',
      'tb_webhook_signature_failures_total',
      'tb_escrow_transitions_rejected_total',
    ]) {
      expect(text).toContain(`# TYPE ${name} counter`);
    }
  });

  it('SEC-LOG-05 a failed sign-in moves the sign-in failure counter', async () => {
    const before = (await value('tb_signin_failures_total')) ?? 0;
    const a = await s.fx.account();
    await s.browser().post('/auth/signin', { login: a.phone, password: 'wrong' });
    expect(await value('tb_signin_failures_total')).toBe(before + 1);
  });

  it('SEC-LOG-05 a code sent moves the OTP counter', async () => {
    const before = (await value('tb_otp_sent_total')) ?? 0;
    const { a, b } = await s.signedIn();
    await s.fx.clearSendGap(a.phone);
    await b.post('/auth/step-up/start', { action: 'password.change' });
    expect(await value('tb_otp_sent_total')).toBeGreaterThan(before);
  });

  it('SEC-LOG-05 a staff member viewing KYC records moves their own count', async () => {
    const member = await s.signedIn({ kyc: 'unsubmitted' });
    const { id } = await submitKyc(member.b);
    const op = await s.signedInStaff('operator');
    await op.b.post(`/staff/kyc/submissions/${id}/claim`);
    await op.b.get(`/staff/kyc/submissions/${id}`);
    await op.b.post(`/staff/kyc/submissions/${id}/files/doc_front/view`, { reason: 'Comparing the photo and the selfie' });
    expect(await value('tb_kyc_views_total', { staff: op.s.staffId })).toBeGreaterThanOrEqual(1);
  });

  it('SEC-LOG-05 an escrow change the database refuses, met by a request, moves the rejected-transition counter', async () => {
    const before = (await value('tb_escrow_transitions_rejected_total')) ?? 0;
    const r = await fetch(s.t.url('/test-log-05'), { method: 'POST', headers: { origin: s.origin } });
    expect(r.status).toBe(500); // the trigger of I-10 refused it
    expect(await value('tb_escrow_transitions_rejected_total')).toBe(before + 1);
  });
});
