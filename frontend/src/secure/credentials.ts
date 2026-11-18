// /secure/orders/{id}/credentials: the buyer opens the login details with the key kept in this browser and takes
// the account over (FR-GAM-11 to FR-GAM-15; NFR-USE-03). Beside the details: the takeover checklist, each step
// confirmed by its own button, the remaining window as a countdown and the end of the protection period. "The login
// details do not work" is offered until the recovery e-mail step is confirmed (FR-GAM-14); a buyer whose browser
// lost the key may ask once for them to be sent again, for a new key (FR-GAM-12). Each retrieval is logged by the
// server, so the details are fetched once per page load.
import { generateBuyerKey, open } from '../lib/sealed.js';
import { b64u, deadline, h, show, unb64u, when } from './dom';
import { errorText, gamePath, orderLink, STEPS, type Credentials, type Ctx, type GameView } from './context';

export async function credentialsScreen(ctx: Ctx): Promise<void> {
  const { api, t, orderId, root } = ctx;
  const title = h('h1', { tabindex: '-1' }, t('secure.credentials.title'));
  const back = h('p', {}, h('a', { href: orderLink(orderId) }, t('secure.back_to_order')));
  const g = (await api.get(gamePath(orderId))) as GameView;
  const say = (text: string, ...more: (Node | null)[]) => show(root, title, h('p', { role: 'status' }, text), ...more, back);

  if (g.role !== 'buyer') return say(t('secure.credentials.not_buyer'));
  if (g.status === 'rekey_requested') return say(t('secure.credentials.rekey_waiting'), g.rekeyDueAt ? h('p', {}, t('secure.credentials.rekey_due'), ' ', deadline(g.rekeyDueAt, ctx.lang, ctx.now)) : null);
  if (g.status === 'cancelled' || g.status === 'closed') return say(t('secure.credentials.gone'));
  if (g.status !== 'delivered' && g.status !== 'taken_over' && g.status !== 'disputed') return say(t('secure.credentials.not_yet'));

  let credentials: Credentials | null = null;
  let problem: string | null = null;
  try {
    const s = (await api.get(gamePath(orderId, '/sealed'))) as { keyVersion: number; enc: string; ciphertext: string };
    const pair = await ctx.keys.load(orderId, s.keyVersion);
    if (!pair) problem = t('secure.credentials.no_key');
    else {
      try {
        credentials = (await open(pair, orderId, s.keyVersion, unb64u(s.enc), unb64u(s.ciphertext))) as Credentials;
      } catch {
        problem = t('secure.credentials.cannot_open');
      }
    }
  } catch (e) {
    problem = errorText(e, t);
  }
  const state = { g };
  const area = h('div');
  const draw = () => area.replaceChildren(...parts(ctx, state.g, credentials, problem, async () => {
    state.g = (await api.get(gamePath(orderId))) as GameView;
    draw();
  }));
  draw();
  show(root, title, area, back);
}

function parts(ctx: Ctx, g: GameView, c: Credentials | null, problem: string | null, refresh: () => Promise<void>): Node[] {
  const { t, lang, now } = ctx;
  const out: Node[] = [];
  const reportable = g.status === 'delivered' && !g.steps.recovery_email;
  if (problem) {
    out.push(h('p', { class: 'error', role: 'alert' }, problem));
    if (reportable && g.rekeysUsed === 0) out.push(rekey(ctx, g));
  }
  if (c) {
    out.push(h('section', { 'aria-labelledby': 'details-title', class: 'panel' },
      h('h2', { id: 'details-title' }, t('secure.credentials.details')),
      h('dl', { class: 'details' },
        h('dt', {}, t('secure.deliver.login_id')), h('dd', { class: 'secret' }, c.loginId ?? ''),
        h('dt', {}, t('secure.deliver.password')), h('dd', { class: 'secret' }, c.password ?? ''),
        ...(c.recovery?.length ? [h('dt', {}, t('secure.deliver.recovery')), h('dd', {}, h('ul', {}, ...c.recovery.map((r) => h('li', { class: 'secret' }, r))))] : []),
        ...(c.note ? [h('dt', {}, t('secure.deliver.note')), h('dd', {}, c.note)] : [])),
      h('p', { class: 'hint' }, t('secure.credentials.private'))));
  }
  if (g.status === 'disputed') out.push(h('p', { role: 'status' }, t('secure.credentials.disputed')));
  if (g.status === 'delivered' || g.status === 'taken_over') out.push(checklist(ctx, g, refresh));
  if (g.status === 'delivered' && g.takeoverDueAt) out.push(h('p', {}, t('secure.credentials.window'), ' ', deadline(g.takeoverDueAt, lang, now)));
  if (g.protectionEndsAt) out.push(h('p', {}, t('secure.credentials.protection', { at: when(g.protectionEndsAt, lang) })));
  if (reportable) out.push(report(ctx, refresh));
  return out;
}

function checklist(ctx: Ctx, g: GameView, refresh: () => Promise<void>): Node {
  const { api, t, lang, orderId } = ctx;
  const message = h('p', { class: 'error', role: 'alert', hidden: true });
  const items = STEPS.map((step) => {
    const done = g.steps[step];
    if (done) return h('li', {}, h('span', {}, t(`secure.step.${step}`)), ' ', h('strong', {}, t('secure.step.done', { at: when(done, lang) })));
    const button = h('button', { type: 'button', class: 'secondary', disabled: g.status !== 'delivered' }, t('secure.step.confirm', { step: t(`secure.step.${step}`) }));
    button.addEventListener('click', async () => {
      button.disabled = true;
      message.hidden = true;
      try {
        await api.post(gamePath(orderId, `/takeover-steps/${step}`), {});
      } catch (e) {
        message.textContent = errorText(e, t);
        message.hidden = false;
      }
      await refresh();
    });
    return h('li', {}, h('span', {}, t(`secure.step.${step}`)), ' ', button);
  });
  return h('section', { 'aria-labelledby': 'checklist-title', class: 'panel' },
    h('h2', { id: 'checklist-title' }, t('secure.checklist.title')),
    h('p', { class: 'hint' }, t(g.status === 'taken_over' ? 'secure.checklist.complete' : 'secure.checklist.explain')),
    message,
    h('ol', { class: 'checklist' }, ...items));
}

function report(ctx: Ctx, refresh: () => Promise<void>): Node {
  const { api, t, orderId } = ctx;
  const text = h('textarea', { id: 'report-text', rows: '3', maxlength: '2000', 'aria-describedby': 'report-hint' });
  const message = h('p', { class: 'error', role: 'alert', hidden: true });
  const sendButton = h('button', { type: 'submit', class: 'primary' }, t('secure.report.send'));
  const cancel = h('button', { type: 'button', class: 'secondary' }, t('secure.report.cancel'));
  const form = h('form', { novalidate: true, hidden: true },
    h('p', {}, t('secure.report.consequence')),
    h('label', { for: 'report-text' }, t('secure.report.describe')), text,
    h('p', { class: 'hint', id: 'report-hint' }, t('secure.report.hint')),
    message, h('p', {}, sendButton, ' ', cancel));
  const start = h('button', { type: 'button', class: 'secondary' }, t('secure.report.start'));
  start.addEventListener('click', () => { form.hidden = false; start.hidden = true; text.focus(); });
  cancel.addEventListener('click', () => { form.hidden = true; start.hidden = false; message.hidden = true; });
  const done = h('div');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = text.value.trim();
    if (d && d.length < 20) { message.textContent = t('secure.report.too_short'); message.hidden = false; return; }
    sendButton.disabled = true;
    try {
      const r = (await api.post(gamePath(orderId, '/report-invalid'), d ? { description: d } : {})) as { disputeId: string };
      done.replaceChildren(h('p', { class: 'success', role: 'status' }, t('secure.report.done'), ' ',
        h('a', { href: `/disputes/${encodeURIComponent(r.disputeId)}` }, t('secure.report.see'))));
      form.hidden = true;
      await refresh();
    } catch (err) {
      message.textContent = errorText(err, t);
      message.hidden = false;
      sendButton.disabled = false;
    }
  });
  return h('section', { 'aria-labelledby': 'report-title', class: 'panel' },
    h('h2', { id: 'report-title' }, t('secure.report.title')), start, form, done);
}

function rekey(ctx: Ctx, g: GameView): Node {
  const { api, t, lang, orderId, now } = ctx;
  const message = h('p', { class: 'error', role: 'alert', hidden: true });
  const ask = h('button', { type: 'button', class: 'primary' }, t('secure.rekey.ask'));
  ask.addEventListener('click', async () => {
    ask.disabled = true;
    message.hidden = true;
    try {
      const { pair, publicRaw } = await generateBuyerKey();
      const next = g.keyVersion + 1; // DV-37: the key version is the re-keys used plus one
      await ctx.keys.store(orderId, next, pair);
      const r = (await api.post(gamePath(orderId, '/rekey'), { publicKey: b64u(publicRaw) })) as { keyVersion: number; redeliveryDueAt: string };
      if (r.keyVersion !== next) await ctx.keys.store(orderId, r.keyVersion, pair);
      section.replaceChildren(h('p', { class: 'success', role: 'status' }, t('secure.rekey.done'), ' ', deadline(r.redeliveryDueAt, lang, now)));
    } catch (e) {
      message.textContent = errorText(e, t);
      message.hidden = false;
      ask.disabled = false;
    }
  });
  const section = h('section', { 'aria-labelledby': 'rekey-title', class: 'panel' },
    h('h2', { id: 'rekey-title' }, t('secure.rekey.title')),
    h('p', {}, t('secure.rekey.explain')),
    h('p', { class: 'hint' }, t('secure.same_browser')),
    message, h('p', {}, ask));
  return section;
}
