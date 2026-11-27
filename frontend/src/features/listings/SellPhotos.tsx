// The photos of a listing being sold: upload, order and removal, with the limits of the photo rules.
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { type EditableListing, type SellingTerms } from './sell';
import styles from './sell.module.css';
import { Button, Checkbox } from '../../shared/ui';
import { listingKey } from './sellShared';

export function Photos({ l, terms, t, lang }: { l: EditableListing; terms: SellingTerms; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [defects, setDefects] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const left = terms.photos.max - l.photos.length;
  const refresh = () => queryClient.invalidateQueries({ queryKey: listingKey(l.id) });

  const upload = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setMessage(null);
    if (files.length > left) return setMessage(t('sell.photos_too_many', { left: toLocalDigits(String(left), lang) }));
    const refused: string[] = [];
    for (const [i, f] of files.entries()) {
      setProgress(t('sell.photo_progress', { n: toLocalDigits(String(i + 1), lang), of: toLocalDigits(String(files.length), lang), name: f.name }));
      if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > terms.photos.maxBytes) {
        refused.push(f.name);
        continue;
      }
      const form = new FormData();
      form.set('showsDefects', defects ? 'true' : 'false');
      form.set('photo', f, f.name);
      try {
        await api.post(`/listings/${encodeURIComponent(l.id)}/photos`, form);
      } catch {
        refused.push(f.name);
      }
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    if (refused.length) setMessage(t('sell.photos_refused', { names: refused.join(', ') }));
    await refresh();
  };
  const remove = useMutation({
    mutationFn: (pid: string) => api.del(`/listings/${encodeURIComponent(l.id)}/photos/${encodeURIComponent(pid)}`),
    onSuccess: () => void refresh(),
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  return (
    <section aria-labelledby="photos-title" className={styles.panel}>
      <h2 id="photos-title">{t('sell.photos')}</h2>
      <p className={styles.hint}>
        {t('sell.photos_hint', { min: toLocalDigits(String(terms.photos.min), lang), max: toLocalDigits(String(terms.photos.max), lang) })}
      </p>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <ul className={styles.photos}>
        {l.photos.map((p, i) => (
          <li key={p.id}>
            <span className={styles.tile}>
              <img src={p.thumbUrl} alt={t('sell.photo_alt', { n: toLocalDigits(String(i + 1), lang) })} width={200} height={200} />
              {i === 0 && <span className={styles.cover}>{t('sell.cover')}</span>}
              {p.showsDefects && <span className={styles.tag}>{t('sell.shows_defects')}</span>}
            </span>
            <Button variant="secondary" type="button" disabled={remove.isPending} onClick={() => remove.mutate(p.id)}>
              {t('sell.remove_photo', { n: toLocalDigits(String(i + 1), lang) })}
            </Button>
          </li>
        ))}
      </ul>
      {left > 0 && (
        <>
          <Checkbox id="shows-defects" checked={defects} onChange={(e) => setDefects(e.target.checked)} label={t('sell.these_show_defects')} />
          <div className={styles.addTile}>
            <label htmlFor="photo-files">{t('sell.add_photos', { left: toLocalDigits(String(left), lang) })}</label>
            <span className={styles.hint}>{t('sell.add_photos_formats')}</span>
            <input
              ref={input}
              id="photo-files"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={progress !== null}
              onChange={(e) => void upload(e.target.files)}
            />
          </div>
        </>
      )}
      {progress && <p role="status">{progress}</p>}
    </section>
  );
}
