// The KYC wizard (IF-UI-02, NFR-USE-02; section 5.2), in kyc.html, the only document allowed the camera.
// The requirements come before any capture; the review status is shown above every step; the images
// stay in memory and are sent once, at the end, to POST /kyc/submissions (multipart, through
// lib/api.js). Files already sent are shown only through Unit 1's signed links.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { errorText } from '../../shared/errors';
import { ErrorSummary, FormMessage, TextField, type SummaryItem } from '../../shared/form';
import { ME_KEY } from '../../shared/me';
import { fieldErrors, isApiError, problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { Capture, Preview } from './Capture';
import { useKycT } from './common';
import {
  FILES_FOR, isSelfie, maySubmit, normaliseDocNumber, reasonKey, STATUS_KEY, validDateOfBirth, validDocNumber,
  type Challenge, type DocType, type ImageKind, type KycStatusView,
} from './model';
import styles from './kyc.module.css';

export function Component() {
  const { t, lang } = useKycT();
  const api = useApi();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: ({ signal }) => api.get('/kyc/status', { signal }) as Promise<KycStatusView>,
    staleTime: FRESHNESS.account,
    retry: false,
  });

  if (status.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (status.isError) {
    if (isApiError(status.error, 401)) {
      return (
        <div className={styles.narrow}>
          <h1>{t('kyc.title')}</h1>
          <p>{t('kyc.signed_out')}</p>
          <p><a href={`/signin?next=${encodeURIComponent('/account/kyc')}`}>{t('kyc.sign_in')}</a></p>
        </div>
      );
    }
    return <FormMessage kind="error">{errorText(status.error, t, lang)}</FormMessage>;
  }

  const s = status.data;
  return (
    <div className={styles.narrow}>
      <h1>{t('kyc.title')}</h1>
      <StatusBar status={s} />
      {maySubmit(s) ? <Wizard /> : <AfterSubmission status={s} />}
    </div>
  );
}

/** NFR-USE-02: the review status, on every step; after a rejection, the reason and what to do. */
function StatusBar({ status }: { status: KycStatusView }) {
  const { t, lang } = useKycT();
  const d = (n: number) => toLocalDigits(String(n), lang);
  const reason = status.rejection ? reasonKey(status.rejection.reason) : null;
  return (
    <section className={styles.status} aria-labelledby="kyc-status-title" aria-live="polite">
      <h2 id="kyc-status-title">{t('status.title')}</h2>
      <p><strong>{t(`status.${status.status}`)}</strong></p>
      {status.status === 'pending_review' && <p>{t('status.expected', { hours: d(status.expectedReviewHours) })}</p>}
      {status.status === 'verified' && <p>{t('status.verified_since', { at: formatDateTime(Date.parse(status.changedAt), lang) })}</p>}
      {reason && (
        <>
          <p>{t(`reason.${reason}`)}</p>
          {status.rejection?.note && <p>{t('status.note', { note: status.rejection.note })}</p>}
        </>
      )}
      {status.status === 'rejected' && (
        <p>{status.submissionsLeft > 0 ? t('status.attempts_left', { n: d(status.submissionsLeft) }) : t('status.no_attempts')}</p>
      )}
    </section>
  );
}

/** Pending, verified, revoked, or no attempts left: the images already sent, through signed links. */
function AfterSubmission({ status }: { status: KycStatusView }) {
  const { t, lang } = useKycT();
  const api = useApi();
  const [links, setLinks] = useState<{ kind: ImageKind; url: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (status.status === 'unsubmitted') return null;

  const show = async () => {
    setBusy(true);
    setError(null);
    const found: { kind: ImageKind; url: string }[] = [];
    try {
      for (const kind of ['doc_front', 'doc_back', 'passport_photo_page', 'selfie_neutral', 'selfie_action'] as ImageKind[]) {
        try {
          const r: { url: string } = await api.post(`/kyc/files/${kind}/view`, {});
          if (r.url.startsWith('/api/v1/files/v/')) found.push({ kind, url: r.url });
        } catch (e) {
          if (!isApiError(e, 404)) throw e;   // a kind this document does not have
        }
      }
      setLinks(found);
    } catch (e) {
      setError(errorText(e, t, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="kyc-sent-title" className={styles.sent}>
      <h2 id="kyc-sent-title">{t('sent.title')}</h2>
      {error && <FormMessage kind="error">{error}</FormMessage>}
      {links === null
        ? <button type="button" className={styles.secondary} onClick={() => void show()} disabled={busy}>{t('sent.show')}</button>
        : (
          <ul className={styles.thumbs}>
            {links.map((l) => <li key={l.kind}><img src={l.url} alt={t(`image.${l.kind}.title`)} className={styles.preview} /></li>)}
          </ul>
        )}
    </section>
  );
}

type Step = 'intro' | 'details' | ImageKind | 'review';

function Wizard() {
  const { t, lang } = useKycT();
  const api = useApi();
  const queryClient = useQueryClient();

  const [docType, setDocType] = useState<DocType>('nid');
  const [details, setDetails] = useState({ docNumber: '', fullName: '', dateOfBirth: '' });
  const [detailErrors, setDetailErrors] = useState<Partial<Record<keyof typeof details, string>>>({});
  const [images, setImages] = useState<Partial<Record<ImageKind, Blob>>>({});
  const [imageErrors, setImageErrors] = useState<Partial<Record<ImageKind, string>>>({});
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);

  const steps: Step[] = ['intro', 'details', ...FILES_FOR[docType], 'review'];
  const [step, setStep] = useState<Step>('intro');
  const index = steps.indexOf(step);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    heading.current?.focus();
  }, [step]);

  // The liveness action is asked for when its step is reached, and again once it has expired. One
  // request at a time, also when development mode runs the effect twice (the endpoint is rate-limited).
  const asking = useRef(false);
  useEffect(() => {
    if (step !== 'selfie_action' || asking.current) return;
    if (challenge && Date.parse(challenge.expiresAt) - Date.now() > 60_000) return;
    asking.current = true;
    api.get('/kyc/liveness-challenge')
      .then((c: Challenge) => { setChallenge(c); setImages((i) => ({ ...i, selfie_action: undefined })); })
      .catch((e: unknown) => setMessage(errorText(e, t, lang)))
      .finally(() => { asking.current = false; });
  }, [step, challenge, api, t, lang]);

  const checkDetails = () => {
    const e: typeof detailErrors = {};
    if (!validDocNumber(docType, details.docNumber)) e.docNumber = t(`details.number_invalid.${docType}`);
    if (details.fullName.trim().length < 2) e.fullName = t('details.name_invalid');
    if (!validDateOfBirth(details.dateOfBirth)) e.dateOfBirth = t('details.dob_invalid');
    setDetailErrors(e);
    return Object.keys(e).length === 0;
  };

  const canGoOn = step === 'intro' || step === 'details' || step === 'review' || Boolean(images[step]);
  const next = (ev?: FormEvent) => {
    ev?.preventDefault();
    if (step === 'details' && !checkDetails()) return;
    if (!canGoOn) return;
    setMessage(null);
    setStep(steps[Math.min(index + 1, steps.length - 1)]);
  };
  const back = () => { setMessage(null); setStep(steps[Math.max(index - 1, 0)]); };

  const submit = async () => {
    if (busy || !challenge) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.append('docType', docType);
    form.append('docNumber', normaliseDocNumber(details.docNumber));
    form.append('fullName', details.fullName.trim().replace(/\s+/g, ' '));
    form.append('dateOfBirth', details.dateOfBirth);
    form.append('challengeId', challenge.challengeId);
    for (const k of FILES_FOR[docType]) {
      const image = images[k]!;
      form.append(k, image, `${k}.${image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg'}`);
    }
    try {
      await api.post('/kyc/submissions', form);
      setImages({});                       // nothing of the images stays in memory after sending
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
        queryClient.invalidateQueries({ queryKey: ME_KEY }),
      ]);
    } catch (err) {
      refused(err);
      setBusy(false);
    }
  };

  /** Sends the user back to the step that can fix the refusal. */
  const refused = (err: unknown) => {
    const name = problemName(err);
    if (isApiError(err, 429)) { setWaitUntil(untilAfter(err.retryAfter ?? 60)); setMessage(errorText(err, t, lang)); return; }
    if (isApiError(err, 413)) { setMessage(t('capture.too_large')); return; }
    if (name === 'kyc-limit') { setMessage(t('submit.limit')); void queryClient.invalidateQueries({ queryKey: STATUS_KEY }); return; }
    if (name === 'kyc-not-allowed') { setMessage(t('submit.not_allowed')); void queryClient.invalidateQueries({ queryKey: STATUS_KEY }); return; }
    if (name !== 'validation-failed') { setMessage(errorText(err, t, lang)); return; }
    const fields = fieldErrors(err);
    const de: typeof detailErrors = {};
    const ie: typeof imageErrors = {};
    let to: Step | null = null;
    for (const f of fields) {
      if (f.field === 'docNumber') { de.docNumber = t(`details.number_invalid.${docType}`); to ??= 'details'; }
      else if (f.field === 'fullName') { de.fullName = t('details.name_invalid'); to ??= 'details'; }
      else if (f.field === 'dateOfBirth') { de.dateOfBirth = t('details.dob_invalid'); to ??= 'details'; }
      else if (f.field === 'challengeId') {
        // the action expired or was used: a new one, and the action selfie again
        setChallenge(null);
        ie.selfie_action = t('submit.challenge_expired');
        to ??= 'selfie_action';
      } else if ((FILES_FOR[docType] as string[]).includes(f.field)) {
        const k = f.field as ImageKind;
        ie[k] = f.reason === 'too-large' ? t('capture.too_large') : f.reason === 'required' ? t('capture.required') : t('capture.unreadable');
        setImages((i) => ({ ...i, [k]: undefined }));
        to ??= k;
      }
    }
    setDetailErrors(de);
    setImageErrors(ie);
    if (ie.selfie_action) setImages((i) => ({ ...i, selfie_action: undefined }));
    if (to) setStep(to);
    else setMessage(errorText(err, t, lang));
  };

  const setImage = (k: ImageKind) => (b: Blob | null) => {
    setImages((i) => ({ ...i, [k]: b ?? undefined }));
    setImageErrors((e) => ({ ...e, [k]: undefined }));
  };

  const set = (k: keyof typeof details) => (v: string) => setDetails((d) => ({ ...d, [k]: v }));
  const summary: SummaryItem[] = (Object.entries(detailErrors) as [string, string][]).map(([f, m]) => ({ id: `kyc-${f}`, message: m }));

  return (
    <section aria-labelledby="kyc-step-title" className={styles.wizard}>
      <p className={styles.progress}>{t('wizard.progress', { n: toLocalDigits(String(index + 1), lang), total: toLocalDigits(String(steps.length), lang) })}</p>
      <h2 id="kyc-step-title" ref={heading} tabIndex={-1} className={styles.stepTitle}>{t(`step.${step}`)}</h2>
      {message && <FormMessage kind="error">{message}</FormMessage>}

      {step === 'intro' && (
        <div>
          <p>{t('intro.lead')}</p>
          <ul>
            {(['document', 'both_sides', 'selfie', 'light', 'whole', 'time'] as const).map((k) => <li key={k}>{t(`intro.${k}`)}</li>)}
          </ul>
          <p>{t('intro.privacy')}</p>
        </div>
      )}

      {step === 'details' && (
        <form id="kyc-details" onSubmit={next} noValidate>
          <ErrorSummary title={t('form.errors_title')} items={summary} />
          <fieldset className={styles.choice}>
            <legend>{t('details.type')}</legend>
            {(['nid', 'passport'] as const).map((d) => (
              <div key={d}>
                <input id={`kyc-type-${d}`} type="radio" name="docType" value={d} checked={docType === d}
                  onChange={() => { setDocType(d); setImages({}); }} />
                <label htmlFor={`kyc-type-${d}`}>{t(`details.type.${d}`)}</label>
              </div>
            ))}
          </fieldset>
          <TextField id="kyc-docNumber" label={t(`details.number.${docType}`)} hint={t(`details.number_hint.${docType}`)}
            value={details.docNumber} onChange={set('docNumber')} error={detailErrors.docNumber} autoComplete="off" maxLength={30} />
          <TextField id="kyc-fullName" label={t('details.name')} hint={t('details.name_hint')} value={details.fullName}
            onChange={set('fullName')} error={detailErrors.fullName} autoComplete="name" maxLength={100} />
          <TextField id="kyc-dateOfBirth" label={t('details.dob')} hint={t('details.dob_hint')} value={details.dateOfBirth}
            onChange={set('dateOfBirth')} error={detailErrors.dateOfBirth} type="date" autoComplete="bday" />
        </form>
      )}

      {isImage(step) && (
        <>
          {step === 'selfie_action' && challenge && (
            <p className={styles.action} role="status">{t('action.do', { action: t(`action.${challenge.action}`) })}</p>
          )}
          {(step !== 'selfie_action' || challenge) && (
            <Capture key={step} id={`kyc-${step}`} title={t(`image.${step}.title`)} labelledBy="kyc-step-title" hint={t(`image.${step}.hint`)}
              facing={isSelfie(step) ? 'user' : 'environment'} allowFile={!isSelfie(step)} value={images[step] ?? null}
              onChange={setImage(step)} error={imageErrors[step]} />
          )}
        </>
      )}

      {step === 'review' && (
        <div>
          <dl className={styles.facts}>
            <div><dt>{t('details.type')}</dt><dd>{t(`details.type.${docType}`)}</dd></div>
            <div><dt>{t(`details.number.${docType}`)}</dt><dd>{normaliseDocNumber(details.docNumber)}</dd></div>
            <div><dt>{t('details.name')}</dt><dd>{details.fullName.trim()}</dd></div>
            <div><dt>{t('details.dob')}</dt><dd>{toLocalDigits(details.dateOfBirth, lang)}</dd></div>
          </dl>
          <ul className={styles.thumbs}>
            {FILES_FOR[docType].map((k) => images[k] && (
              <li key={k}><Preview image={images[k]!} alt={t(`image.${k}.title`)} /><span>{t(`image.${k}.title`)}</span></li>
            ))}
          </ul>
          <p>{t('review.once')}</p>
        </div>
      )}

      <div className={styles.nav}>
        {index > 0 && <button type="button" className={styles.secondary} onClick={back} disabled={busy}>{t('wizard.back')}</button>}
        {step === 'review'
          ? (
            <button type="button" className={styles.primary} onClick={() => void submit()} disabled={busy || waitFor > 0 || !challenge}
              aria-busy={busy || undefined}>
              {waitFor > 0 ? t('wizard.wait', { seconds: toLocalDigits(String(waitFor), lang) }) : t('review.submit')}
            </button>
          )
          : step === 'details'
            ? <button type="submit" form="kyc-details" className={styles.primary}>{t('wizard.next')}</button>
            : <button type="button" className={styles.primary} onClick={() => next()} disabled={!canGoOn}>{t(step === 'intro' ? 'intro.start' : 'wizard.next')}</button>}
      </div>
    </section>
  );
}

const isImage = (s: Step): s is ImageKind => s !== 'intro' && s !== 'details' && s !== 'review';
