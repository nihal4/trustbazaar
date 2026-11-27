import { formatWait } from '../../shared/wait';
import { type ReactNode } from 'react';
import { CheckboxField, CodeField, SubmitButton, TextField } from '../../shared/form';
import { digits } from './common';
import { PASSWORD } from './input';
import { Slot } from './AuthParts';
import { AuthSplit } from './AuthSplit';
import { LegalDialog } from './LegalDocs';
import styles from './account.module.css';
import { Button } from '../../shared/ui';
import { useRegisterFlow } from './registerFlow';

export function Component() {
  const flow = useRegisterFlow();
  let card: ReactNode;
  if (flow.step === 'name') {
    card = (
      <AuthSplit stepKey="name" rows={flow.rows} headCells={flow.head} head={flow.heading} foot={flow.signIn}>
        <form onSubmit={flow.toEmail} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            <TextField
              id="register-name"
              label={flow.t('register.name')}
              hint={flow.t('register.name_hint')}
              value={flow.name}
              onChange={flow.setName}
              autoComplete="name"
              maxLength={40}
              autoFocus
              {...flow.aria()}
            />
            <Slot id="register-message" message={flow.message} ok={flow.notice} />
          </div>
          <SubmitButton busy={false}>{flow.t('signin.continue')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  } else if (flow.step === 'email') {
    card = (
      <AuthSplit stepKey="email" rows={flow.rows} headCells={flow.head} head={flow.heading} foot={flow.signIn}>
        <form onSubmit={(e) => void flow.toPassword(e)} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            <TextField
              id="register-email"
              label={flow.t('field.email')}
              value={flow.email}
              onChange={flow.setEmail}
              type="email"
              autoComplete="email"
              autoFocus
              {...flow.aria()}
            />
            <Slot id="register-message" message={flow.message} ok={flow.notice} />
          </div>
          <SubmitButton busy={flow.busy}>{flow.busy ? flow.t('signin.working') : flow.t('signin.continue')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  } else if (flow.step === 'password') {
    card = (
      <AuthSplit stepKey="password" rows={flow.rows} headCells={flow.head} head={flow.heading} foot={flow.signIn}>
        <form onSubmit={(e) => void flow.begin(e)} noValidate className={styles.stepForm}>
          <input type="text" name="username" autoComplete="username" value={flow.email} readOnly tabIndex={-1} aria-hidden="true" className={styles.srOnly} />
          <div className={styles.fieldGroup}>
            <TextField
              id="register-password"
              label={flow.t('field.password')}
              hint={flow.t('register.password_hint', { min: digits(PASSWORD.minSingleFactor, flow.lang) })}
              value={flow.password}
              onChange={flow.setPassword}
              type="password"
              autoComplete="new-password"
              autoFocus
              {...flow.aria(flow.message === flow.t('register.password_mismatch'))}
            />
            <TextField
              id="register-confirm"
              label={flow.t('register.confirm')}
              value={flow.confirm}
              onChange={flow.setConfirm}
              type="password"
              autoComplete="new-password"
              {...flow.aria(flow.message !== flow.t('register.password_mismatch'))}
            />
            <Slot id="register-message" message={flow.message} ok={flow.notice} />
          </div>
          <SubmitButton busy={flow.busy} disabled={flow.waitFor > 0}>
            {flow.button ?? flow.t('signin.continue')}
          </SubmitButton>
        </form>
      </AuthSplit>
    );
  } else if (flow.step === 'code') {
    card = (
      <AuthSplit
        stepKey="code"
        rows={flow.rows}
        headCells={flow.head}
        head={
          <>
            <h1 id="register-head">{flow.t('register.code_title')}</h1>
            <p className={styles.lead}>{flow.t('register.code_sent_email', { email: flow.email.trim() })}</p>
          </>
        }
        foot={
          <div className={styles.footLinks}>
            <Button variant="link" type="button" onClick={flow.backTo('password')}>
              {flow.t('register.change_details')}
            </Button>
            <Button variant="link" type="button" aria-disabled={flow.resending || flow.resendIn > 0} onClick={() => void flow.resend()}>
              {flow.resendIn > 0 ? flow.t('signin.resend_wait', { time: formatWait(flow.resendIn, flow.lang) }) : flow.t('signin.resend')}
            </Button>
          </div>
        }
      >
        <form onSubmit={(e) => void flow.verify(e)} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            <CodeField id="register-code" label={flow.t('code.label')} value={flow.code} onChange={flow.setCode} autoFocus {...flow.aria(flow.notice)} />
            <Slot id="register-message" message={flow.message} ok={flow.notice} />
          </div>
          <SubmitButton busy={flow.busy} disabled={flow.waitFor > 0}>
            {flow.button ?? flow.t('register.verify')}
          </SubmitButton>
        </form>
      </AuthSplit>
    );
  } else if (flow.step === 'phone') {
    card = (
      <AuthSplit stepKey="phone" rows={flow.rows} headCells={flow.head} head={flow.heading} foot={flow.signIn}>
        <form onSubmit={flow.toTerms} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            <TextField
              id="register-phone"
              label={flow.t('field.phone')}
              hint={flow.t('field.phone_hint')}
              value={flow.phone}
              onChange={flow.setPhone}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              {...flow.aria()}
            />
            <Slot id="register-message" message={flow.message} ok={flow.notice} />
          </div>
          <SubmitButton busy={false}>{flow.t('signin.continue')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  } else {
    card = (
      <AuthSplit
        stepKey="terms"
        rows={flow.rows}
        headCells={flow.head}
        head={flow.heading}
        foot={
          <div className={styles.footLinks}>
            <Button variant="link" type="button" onClick={flow.backTo('phone')}>
              {flow.t('signin.back')}
            </Button>
          </div>
        }
      >
        <form onSubmit={(e) => void flow.finish(e)} noValidate className={styles.stepForm}>
          <div className={styles.checks}>
            <div className={styles.extra}>
              <CheckboxField id="register-adult" label={flow.t('register.adult')} checked={flow.adult} onChange={flow.setAdult} autoFocus />
            </div>
            <div className={styles.extra}>
              <CheckboxField id="register-accept" label={flow.acceptLabel} checked={flow.accept} onChange={flow.setAccept} />
            </div>
            <Slot id="register-message" message={flow.message} ok={flow.notice} />
          </div>
          <SubmitButton busy={flow.busy} disabled={flow.waitFor > 0}>
            {flow.button ?? flow.t('register.submit')}
          </SubmitButton>
        </form>
      </AuthSplit>
    );
  }
  return (
    <>
      {card}
      {flow.dialog && <LegalDialog kind={flow.dialog.kind} opener={flow.dialog.opener} onClose={() => flow.setDialog(null)} />}
    </>
  );
}
