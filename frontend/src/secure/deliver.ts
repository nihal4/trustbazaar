// /secure/orders/{id}/deliver: the seller seals the login details for the buyer's key (FR-GAM-08 to FR-GAM-10;
// Unit 5 section 5). The fingerprint of the key the server gave is computed here, to compare with the buyer's. The
// fields have autocomplete and spell-checking off; sealed.js seals in the page and only the ciphertext is sent;
// nothing typed is kept after sending.
import { fingerprint, seal } from '../lib/sealed.js';
import { b64u, deadline, h, show, unb64u } from './dom';
import { errorText, gamePath, orderLink, reasonOf, type Credentials, type Ctx, type GameView } from './context';

const quiet = { autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' };

export async function deliverScreen(ctx: Ctx, notice: string | null = null): Promise<void> {
  const { api, t, lang, orderId, root, now } = ctx;
  const title = h('h1', { tabindex: '-1' }, t('secure.deliver.title'));
  const back = h('p', {}, h('a', { href: orderLink(orderId) }, t('secure.back_to_order')));
  const g = (await api.get(gamePath(orderId))) as GameView;
  const say = (text: string, kind = 'info') => show(root, title, h('p', { class: kind, role: kind === 'error' ? 'alert' : 'status' }, text), back);

  if (g.role !== 'seller') return say(t('secure.deliver.not_seller'));
  if (g.status !== 'awaiting_credentials' && g.status !== 'rekey_requested') {
    if (g.status === 'delivered' && g.takeoverDueAt) {
      return show(root, title, notice ? h('p', { class: 'success', role: 'status' }, notice) : null,
        h('p', {}, t('secure.deliver.sent'), ' ', t('secure.deliver.takeover_by'), ' ', deadline(g.takeoverDueAt, lang, now)), back);
    }
    return say(t('secure.deliver.not_expected'));
  }

  const key = (await api.get(gamePath(orderId, '/buyer-key'))) as { keyVersion: number; publicKey: string };
  const publicRaw = unb64u(key.publicKey);
  const fp = await fingerprint(publicRaw);
  const due = g.status === 'rekey_requested' ? g.rekeyDueAt : g.credentialsDueAt;

  const field = (id: string, label: string, control: HTMLElement, hint?: string) =>
    h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null);
  const loginId = h('input', { id: 'login-id', type: 'text', maxlength: '200', ...quiet });
  const password = h('input', { id: 'password', type: 'password', maxlength: '500', ...quiet });
  const reveal = h('input', { id: 'reveal', type: 'checkbox' });
  reveal.addEventListener('change', () => { password.type = reveal.checked ? 'text' : 'password'; });
  const recovery = h('textarea', { id: 'recovery', rows: '4', maxlength: '2000', 'aria-describedby': 'recovery-hint', ...quiet });
  const note = h('textarea', { id: 'note', rows: '3', maxlength: '1000', ...quiet });
  const message = h('p', { class: 'error', role: 'alert', hidden: true });
  const send = h('button', { type: 'submit', class: 'primary' }, t('secure.deliver.send'));
  const fail = (text: string) => { message.textContent = text; message.hidden = false; send.disabled = false; };

  const form = h('form', { novalidate: true, autocomplete: 'off' },
    field('login-id', t('secure.deliver.login_id'), loginId),
    field('password', t('secure.deliver.password'), password),
    h('div', { class: 'check' }, reveal, h('label', { for: 'reveal' }, t('secure.deliver.reveal'))),
    field('recovery', t('secure.deliver.recovery'), recovery, t('secure.deliver.recovery_hint')),
    field('note', t('secure.deliver.note'), note),
    message,
    h('p', {}, send));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.hidden = true;
    if (!loginId.value.trim() || !password.value) return fail(t('secure.deliver.need'));
    send.disabled = true;
    const credentials: Credentials = {
      loginId: loginId.value.trim(), password: password.value,
      recovery: recovery.value.split('\n').map((s) => s.trim()).filter(Boolean), note: note.value.trim(),
    };
    let sealed: { enc: Uint8Array; ciphertext: Uint8Array };
    try {
      sealed = await seal(publicRaw, orderId, key.keyVersion, credentials);
    } catch {
      return fail(t('secure.deliver.too_long'));
    }
    try {
      await api.post(gamePath(orderId, '/sealed'), { keyVersion: key.keyVersion, enc: b64u(sealed.enc), ciphertext: b64u(sealed.ciphertext) });
    } catch (err) {
      if (reasonOf(err) === 'stale-key-version') return deliverScreen(ctx, t('secure.error.stale-key-version'));
      return fail(errorText(err, t));
    }
    form.reset(); // nothing typed stays in the page
    await deliverScreen(ctx, t('secure.deliver.done'));
  });

  show(root, title,
    notice ? h('p', { class: 'info', role: 'status' }, notice) : null,
    g.status === 'rekey_requested' ? h('p', {}, t('secure.deliver.again')) : null,
    due ? h('p', {}, t('secure.deliver.due'), ' ', deadline(due, lang, now)) : null,
    h('section', { 'aria-labelledby': 'fp-title', class: 'panel' },
      h('h2', { id: 'fp-title' }, t('secure.deliver.fingerprint_title')),
      h('p', {}, t('secure.deliver.fingerprint'), ' ', h('strong', { class: 'fingerprint' }, fp)),
      h('p', { class: 'hint' }, t('secure.deliver.fingerprint_hint'))),
    h('p', { class: 'hint' }, t('secure.deliver.explain')),
    form,
    back);
}
