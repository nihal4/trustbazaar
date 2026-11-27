// /secure/orders/{id}/key: the buyer's key for a game-account order (FR-GAM-07, FR-GAM-08; Decisions log, U8-07).
// The key pair is generated here with a private key that can never be exported, kept in this browser's IndexedDB
// (sealed.js), and only the public key is sent. The fingerprint is computed here, never by the server (Unit 5,
// section "Fingerprint").
import { fingerprint, generateBuyerKey } from '../lib/sealed.js';
import { b64u, h, show } from './dom';
import { errorText, gamePath, orderLink, reasonOf, type Ctx, type GameView } from './context';

export async function publicRawOf(pair: CryptoKeyPair): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
}

export async function keyScreen(ctx: Ctx, notice: string | null = null): Promise<void> {
  const { api, t, orderId, root } = ctx;
  const title = h('h1', { tabindex: '-1' }, t('secure.key.title'));
  const back = h('p', {}, h('a', { href: orderLink(orderId) }, t('secure.back_to_order')));
  const g = (await api.get(gamePath(orderId))) as GameView;
  const say = (text: string, kind = 'info') => show(root, title, h('p', { class: kind, role: kind === 'error' ? 'alert' : undefined }, text), back);

  if (g.role !== 'buyer') return say(t('secure.key.not_buyer'));
  if (g.status !== 'preparing') return say(t('secure.key.after_payment'));
  if (g.disclosure.acknowledgedVersion !== g.disclosure.currentVersion) return say(t('secure.key.acknowledge_first'));

  if (g.keyVersion >= 1) {
    const pair = await ctx.keys.load(orderId, g.keyVersion);
    if (!pair) return say(t('secure.key.other_browser'), 'error');
    const fp = await fingerprint(await publicRawOf(pair));
    return show(
      root,
      title,
      notice ? h('p', { class: 'success', role: 'status' }, notice) : null,
      h('p', {}, t('secure.key.ready')),
      h('p', {}, t('secure.key.fingerprint'), ' ', h('strong', { class: 'fingerprint' }, fp)),
      h('p', { class: 'hint' }, t('secure.key.fingerprint_hint')),
      h('p', { class: 'hint' }, t('secure.same_browser')),
      back,
    );
  }

  const message = h('p', { class: 'error', role: 'alert', hidden: true });
  const create = h('button', { type: 'button', class: 'primary' }, t('secure.key.create'));
  create.addEventListener('click', async () => {
    create.disabled = true;
    message.hidden = true;
    try {
      const { pair, publicRaw } = await generateBuyerKey();
      await ctx.keys.store(orderId, 1, pair); // kept before the server knows it, so a registered key is never lost
      await api.post(gamePath(orderId, '/key'), { publicKey: b64u(publicRaw) });
      await keyScreen(ctx, t('secure.key.created'));
    } catch (e) {
      if (reasonOf(e) === 'key-fixed') return keyScreen(ctx);
      message.textContent = errorText(e, t);
      message.hidden = false;
      create.disabled = false;
    }
  });
  show(root, title, h('p', {}, t('secure.key.explain')), h('p', { class: 'hint' }, t('secure.same_browser')), message, h('p', {}, create), back);
}
