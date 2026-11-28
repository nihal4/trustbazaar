// A game-account listing's own part of the editor (docs/design/08_frontend.pdf section 7.3; Unit 5 section 3;
// FR-GAM-01 to FR-GAM-04; U8-07). The seller names the game, platform, in-game player ID and what the account holds
// (never a login detail); after publication, which always holds the listing for review, the seller asks for a
// one-time code, places it where the game says, and uploads a screenshot showing it before it expires. The proof's
// state, and a rejection's reason, are shown as the server gives them.
import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDeadline } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { fieldErrors } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { reasonTexts, type EditableListing } from './sell';
import { SellErrors } from './SellErrors';
import styles from './sell.module.css';
import { Button, FilePicker, Input, Select, Textarea } from '../../shared/ui';

interface Game {
  id: number;
  slug: string;
  name: string;
  platforms: string[];
  codePlacement: string;
  publisherNote: string;
}
interface GameDetails {
  gameId: number;
  platform: string;
  playerId: string;
  contents: string;
}
type ProofStatus = 'issued' | 'expired' | 'submitted' | 'approved' | 'rejected';
interface Ownership {
  details: GameDetails | null;
  proof: { code: string; status: ProofStatus; expiresAt: string; submittedAt: string | null; reviewedAt: string | null; reason: string | null } | null;
}

const ownershipKey = (id: string) => ['listings', id, 'ownership'] as const;

export function useOwnership(l: EditableListing) {
  const api = useApi();
  return useQuery({
    queryKey: ownershipKey(l.id),
    queryFn: ({ signal }) => api.get(`/listings/${encodeURIComponent(l.id)}/ownership`, { signal }) as Promise<Ownership>,
    staleTime: FRESHNESS.account,
    retry: false,
    enabled: l.itemKind === 'game_account',
  });
}

export function GameListing({ l, t, lang }: { l: EditableListing; t: T; lang: Lang }) {
  const ownership = useOwnership(l);
  if (ownership.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (ownership.isError) return <FormMessage kind="error">{errorText(ownership.error, t, lang)}</FormMessage>;
  const o = ownership.data;
  const proofFixed = o.proof?.status === 'submitted' || o.proof?.status === 'approved';
  return (
    <>
      <GameDetailsForm key={JSON.stringify(o.details)} l={l} details={o.details} fixed={proofFixed} t={t} lang={lang} />
      {l.status === 'pending_review' && o.details && <Proof l={l} o={o} t={t} lang={lang} />}
    </>
  );
}

function GameDetailsForm({ l, details, fixed, t, lang }: { l: EditableListing; details: GameDetails | null; fixed: boolean; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const games = useQuery({
    queryKey: ['games'],
    queryFn: ({ signal }) => api.get('/games', { signal }) as Promise<{ items: Game[] }>,
    staleTime: FRESHNESS.reference,
  });
  const [gameId, setGameId] = useState(details ? String(details.gameId) : '');
  const [platform, setPlatform] = useState(details?.platform ?? '');
  const [playerId, setPlayerId] = useState(details?.playerId ?? '');
  const [contents, setContents] = useState(details?.contents ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const game = (games.data?.items ?? []).find((g) => String(g.id) === gameId) ?? null;
  const save = useMutation({
    mutationFn: (body: GameDetails) => api.put(`/listings/${encodeURIComponent(l.id)}/game-details`, body),
    onSuccess: () => {
      setErrors([]);
      setMessage(null);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ownershipKey(l.id) });
    },
    onError: (e) => {
      const fields = fieldErrors(e);
      setErrors(reasonTexts(fields, t));
      setMessage(fields.length ? null : errorText(e, t, lang));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const problems: string[] = [];
    if (!game) problems.push(t('sell.game.need.game'));
    if (!game?.platforms.includes(platform)) problems.push(t('sell.game.need.platform'));
    if (playerId.trim().length < 2) problems.push(t('sell.game.need.player_id'));
    if (contents.trim().length < 10) problems.push(t('sell.game.need.contents'));
    setErrors(problems);
    if (problems.length || !game) return;
    save.mutate({ gameId: game.id, platform, playerId: playerId.trim(), contents: contents.trim() });
  };
  return (
    <form onSubmit={submit} noValidate className={`${styles.panel} ${styles.form}`} aria-labelledby="game-title">
      <h2 id="game-title">{t('sell.game.title')}</h2>
      <p className={styles.hint}>{t('sell.game.no_logins')}</p>
      <SellErrors errors={errors} t={t} />
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {saved && <FormMessage kind="success">{t('sell.game.saved')}</FormMessage>}
      <label htmlFor="game">{t('sell.field.gameId')}</label>
      <Select
        block
        id="game"
        value={gameId}
        disabled={fixed}
        onChange={(e) => {
          setGameId(e.target.value);
          setPlatform('');
        }}
      >
        <option value="">{t('sell.choose')}</option>
        {(games.data?.items ?? []).map((g) => (
          <option key={g.id} value={String(g.id)}>
            {g.name}
          </option>
        ))}
      </Select>
      {game && <p className={styles.hint}>{game.publisherNote}</p>}
      <label htmlFor="platform">{t('sell.field.platform')}</label>
      <Select block id="platform" value={platform} disabled={fixed || !game} onChange={(e) => setPlatform(e.target.value)}>
        <option value="">{t('sell.choose')}</option>
        {(game?.platforms ?? []).map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      <label htmlFor="player-id">{t('sell.field.playerId')}</label>
      <Input
        block
        id="player-id"
        value={playerId}
        maxLength={64}
        disabled={fixed}
        autoComplete="off"
        onChange={(e) => setPlayerId(e.target.value)}
        aria-describedby="player-id-hint"
      />
      <p id="player-id-hint" className={styles.hint}>
        {t(fixed ? 'sell.game.player_id_fixed' : 'sell.game.player_id_hint')}
      </p>
      <label htmlFor="contents">{t('sell.field.contents')}</label>
      <Textarea block id="contents" value={contents} rows={4} maxLength={2000} onChange={(e) => setContents(e.target.value)} aria-describedby="contents-hint" />
      <p id="contents-hint" className={styles.hint}>
        {t('sell.game.contents_hint')}
      </p>
      <div className={styles.buttons}>
        <Button variant="primary" type="submit" disabled={save.isPending}>
          {t('sell.game.save')}
        </Button>
      </div>
    </form>
  );
}

function Proof({ l, o, t, lang }: { l: EditableListing; o: Ownership; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const now = useServerNow();
  const input = useRef<HTMLInputElement>(null);
  const [placement, setPlacement] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ownershipKey(l.id) });
  const fail = (e: unknown) => {
    const fields = fieldErrors(e);
    setMessage(fields.length ? reasonTexts(fields, t).join(' ') : errorText(e, t, lang));
    void refresh();
  };
  const code = useMutation({
    mutationFn: () => api.post(`/listings/${encodeURIComponent(l.id)}/ownership-code`, {}) as Promise<{ code: string; expiresAt: string; placement: string }>,
    onSuccess: (r) => {
      setMessage(null);
      setPlacement(r.placement);
      void refresh();
    },
    onError: fail,
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set('file', file, file.name);
      return api.post(`/listings/${encodeURIComponent(l.id)}/ownership-proof`, form);
    },
    onSuccess: () => {
      setMessage(null);
      if (input.current) input.current.value = '';
      void refresh();
    },
    onError: (e) => {
      if (input.current) input.current.value = '';
      fail(e);
    },
  });
  const p = o.proof;
  const expired = p?.status === 'expired' || (p?.status === 'issued' && Date.parse(p.expiresAt) <= now);
  const canAsk = !p || expired || p.status === 'rejected';
  return (
    <section aria-labelledby="proof-title" className={styles.panel}>
      <h2 id="proof-title">{t('sell.game.proof_title')}</h2>
      <p className={styles.hint}>{t('sell.game.proof_hint')}</p>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {p && (
        <p>
          <strong>{t(`sell.game.proof.${expired ? 'expired' : p.status}`)}</strong>
        </p>
      )}
      {p?.status === 'rejected' && p.reason && <p>{t('sell.game.rejected_reason', { reason: p.reason })}</p>}
      {p?.status === 'issued' && !expired && (
        <>
          <p>
            {t('sell.game.code_is')} <strong className={styles.code}>{p.code}</strong>
          </p>
          {placement && <p>{t('sell.game.placement', { placement })}</p>}
          <p>{t('sell.game.code_expires', { when: formatDeadline(Date.parse(p.expiresAt), now, lang) })}</p>
          <FilePicker
            inputRef={input}
            id="proof-file"
            action={t('sell.game.upload')}
            accept="image/jpeg,image/png,image/webp"
            disabled={upload.isPending}
            onFiles={(list) => {
              const f = list?.[0];
              if (f) upload.mutate(f);
            }}
          />
          {upload.isPending && <p role="status">{t('sell.game.uploading')}</p>}
        </>
      )}
      {canAsk && (
        <p>
          <Button variant="primary" type="button" disabled={code.isPending} onClick={() => code.mutate()}>
            {t(p ? 'sell.game.new_code' : 'sell.game.get_code')}
          </Button>
        </p>
      )}
    </section>
  );
}
