import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { EMAIL_ADAPTER, EmailAdapter, SMS_ADAPTER, SmsAdapter } from '../adapters/channels';
import type { NotificationPort, SentMessage } from '../ports';
import { renderEmailHtml } from './email-layout';

// NotificationPort for Unit 1 (docs/design/06_chat_notifications.pdf sections 3.3 and 7.2; I-3, I-36; U6-05): the
// one-time codes, links and account notices Unit 1 sends at once, outside the notification history. Their texts
// belong to this unit (I-3). The user's language may not be known yet (registration), so each message carries both,
// Bangla first. An SMS is recorded in notify.sms_log by an HMAC of the number, its purpose and status, never its
// text, so no code reaches the database (SEC-AUTH-09, SEC-DAT-07). The last 100 messages are also kept in memory for
// the tests (`sent`), as the stand-in this replaces did.
type Texts = { subject?: [string, string]; body: [string, string] };
const BOTH = (bn: string, en: string): [string, string] => [bn, en];

export const MESSAGES: Record<string, Texts> = {
  otp_register: { body: BOTH('TrustBazaar: আপনার নিবন্ধনের কোড {code}। {minutes} মিনিট বৈধ। কাউকে জানাবেন না।', 'TrustBazaar: your registration code is {code}. Valid for {minutes} minutes. Never share it.') },
  otp_signin_email: {
    subject: BOTH('আপনার TrustBazaar সাইন-ইন কোড', 'Your TrustBazaar sign-in code'),
    body: BOTH('সাইন ইন করতে এই কোডটি দিন: {code}। {minutes} মিনিট বৈধ। আপনি সাইন ইন না করলে কাউকে কোডটি জানাবেন না এবং পাসওয়ার্ড বদলে নিন।', 'Enter this code to sign in: {code}. Valid for {minutes} minutes. If this was not you, never share the code and change your password.'),
  },
  otp_register_email: {
    subject: BOTH('আপনার TrustBazaar নিবন্ধনের কোড', 'Your TrustBazaar registration code'),
    body: BOTH('আপনার নিবন্ধনের কোড {code}। {minutes} মিনিট বৈধ। কাউকে জানাবেন না।', 'Your registration code is {code}. Valid for {minutes} minutes. Never share it.'),
  },
  otp_password_reset: { body: BOTH('TrustBazaar: পাসওয়ার্ড রিসেটের কোড {code}। {minutes} মিনিট বৈধ।', 'TrustBazaar: your password reset code is {code}. Valid for {minutes} minutes.') },
  otp_phone_change: { body: BOTH('TrustBazaar: নতুন নম্বর যাচাইয়ের কোড {code}। {minutes} মিনিট বৈধ।', 'TrustBazaar: the code to confirm your new number is {code}. Valid for {minutes} minutes.') },
  otp_step_up: { body: BOTH('TrustBazaar: নিশ্চিতকরণ কোড {code}। {minutes} মিনিট বৈধ। আপনি না চাইলে কাউকে জানাবেন না।', 'TrustBazaar: your confirmation code is {code}. Valid for {minutes} minutes. If you did not ask for it, share it with no one.') },
  register_attempt_existing_number: { body: BOTH('TrustBazaar: এই নম্বরে নতুন অ্যাকাউন্ট খোলার চেষ্টা হয়েছে। এটি আপনি হলে সাইন ইন করুন।', 'TrustBazaar: someone tried to open a new account with this number. If it was you, sign in instead.') },
  contact_change_attempt_existing_number: { body: BOTH('TrustBazaar: অন্য একটি অ্যাকাউন্ট এই নম্বর যোগ করার চেষ্টা করেছে। আপনার অ্যাকাউন্ট অপরিবর্তিত আছে।', 'TrustBazaar: another account tried to add this number. Your account is unchanged.') },
  contact_changed: {
    subject: BOTH('আপনার যোগাযোগের তথ্য পরিবর্তন হয়েছে', 'Your contact details were changed'),
    body: BOTH('TrustBazaar: আপনার অ্যাকাউন্টের যোগাযোগের তথ্য পরিবর্তন করা হয়েছে। এটি আপনি না করলে সাপোর্টে যোগাযোগ করুন।', 'TrustBazaar: the contact details of your account were changed. If this was not you, contact support.'),
  },
  signin_throttled: {
    subject: BOTH('আপনার অ্যাকাউন্টে বারবার ভুল সাইন-ইন', 'Repeated failed sign-ins to your account'),
    body: BOTH('TrustBazaar: আপনার অ্যাকাউন্টে কয়েকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে, তাই সাইন-ইন সাময়িকভাবে ধীর করা হয়েছে। পাসওয়ার্ড রিসেট করলে তা উঠে যাবে।', 'TrustBazaar: several wrong passwords were entered for your account, so sign-in is slowed for a while. Resetting your password lifts it.'),
  },
  email_verify: {
    subject: BOTH('আপনার ই-মেইল যাচাই করুন', 'Confirm your e-mail address'),
    body: BOTH('আপনার ই-মেইল যাচাই করতে এই লিংকটি খুলুন ({hours} ঘণ্টা বৈধ): {link}', 'Open this link to confirm your e-mail address (valid for {hours} hours): {link}'),
  },
  email_change: {
    subject: BOTH('নতুন ই-মেইল নিশ্চিত করুন', 'Confirm your new e-mail address'),
    body: BOTH('নতুন ই-মেইল নিশ্চিত করতে এই লিংকটি খুলুন ({hours} ঘণ্টা বৈধ): {link}', 'Open this link to confirm your new e-mail address (valid for {hours} hours): {link}'),
  },
  password_reset: {
    subject: BOTH('পাসওয়ার্ড রিসেট', 'Reset your password'),
    body: BOTH('পাসওয়ার্ড রিসেট করতে এই লিংকটি খুলুন ({minutes} মিনিট বৈধ): {link}। আপনি না চাইলে এটি উপেক্ষা করুন।', 'Open this link to reset your password (valid for {minutes} minutes): {link}. If you did not ask for it, ignore this e-mail.'),
  },
  // to administrators (Unit 7, FR-DSP-08; U7-06): staff have no language setting, so both languages as for every message here
  disputes_overdue: {
    subject: BOTH('সময় পেরিয়ে যাওয়া অভিযোগ', 'Disputes past their decision target'),
    body: BOTH('TrustBazaar: {count}টি অভিযোগের সিদ্ধান্তের লক্ষ্য সময় পেরিয়ে গেছে। সবচেয়ে পুরনোটি {oldest_days} দিন আগে খোলা হয়েছিল। স্টাফ কনসোলের অভিযোগের তালিকা দেখুন।', 'TrustBazaar: {count} disputes are past their decision target. The oldest was opened {oldest_days} days ago. See the disputes queue in the staff console.'),
  },
  register_attempt_existing_email: {
    subject: BOTH('নিবন্ধনের চেষ্টা', 'A registration attempt'),
    body: BOTH('কেউ এই ই-মেইল দিয়ে নতুন TrustBazaar অ্যাকাউন্ট খোলার চেষ্টা করেছে। এটি আপনি হলে সাইন ইন করুন।', 'Someone tried to open a new TrustBazaar account with this e-mail address. If it was you, sign in instead.'),
  },
};

const fill = (t: string, vars: Record<string, string>) => t.replace(/\{([a-z_]+)\}/g, (_, k: string) => vars[k] ?? '');
/** Both languages, Bangla first. */
export function compose(template: string, vars: Record<string, string>): { subject: string; text: string; html: string } {
  const m = MESSAGES[template];
  if (!m) throw new Error(`no message text for ${template}`);
  const subject = m.subject ? `${m.subject[0]} / ${m.subject[1]}` : 'TrustBazaar';
  const [bn, en] = [fill(m.body[0], vars), fill(m.body[1], vars)];
  // the HTML is the same message in the one layout (email-layout.ts); a link message names its button in both languages
  const button = vars.link ? 'Open / খুলুন' : undefined;
  return { subject, text: `${bn}\n\n${en}`, html: renderEmailHtml({ subject, bn, en, vars: button ? { ...vars, button } : vars }) };
}

@Injectable()
export class DirectMessages implements NotificationPort {
  readonly sent: SentMessage[] = [];

  constructor(
    private readonly db: DataSource,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Inject(SMS_ADAPTER) private readonly sms: SmsAdapter,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async sendSms(phone: string, template: string, vars: Record<string, string>): Promise<void> {
    const { text } = compose(template, vars);
    this.keep({ channel: 'sms', to: phone, template, vars });
    const purpose = template.startsWith('otp_') ? 'otp' : 'security_notice';
    let status = 'sent';
    let ref: string | null = null;
    try {
      ref = (await this.sms.send(phone, text)).ref;
    } catch (e) {
      status = 'failed';
      throw e;
    } finally {
      await this.db.query(
        `INSERT INTO notify.sms_log (phone_hmac, purpose, status, provider_ref, simulated, at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [this.phoneHmac(phone), purpose, status, ref, this.sms.simulated, this.clock.now()],
      );
    }
  }

  async sendEmail(address: string, template: string, vars: Record<string, string>): Promise<void> {
    const { subject, text, html } = compose(template, vars);
    this.keep({ channel: 'email', to: address, template, vars });
    await this.email.send(address, subject, text, html);
  }

  /** The number's HMAC for the SMS log, so rate checks and audits never need the number itself. */
  phoneHmac(phone: string): Buffer {
    return createHmac('sha256', this.config.secrets.otpPepper.reveal()).update(`sms-log:${phone}`).digest();
  }

  private keep(m: SentMessage): void {
    this.sent.push(m);
    if (this.sent.length > 100) this.sent.shift();
  }
}
