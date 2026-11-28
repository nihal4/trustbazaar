// Where the item is, on the details form of a listing: an area from the list, or the place this device is at.
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { Button, Select } from '../../shared/ui';
import type { Area } from './sell';
import styles from './sell.module.css';

export function AreaFields({
  t,
  lang,
  areas,
  ready,
  keepDistrict,
  areaId,
  onArea,
  area,
  located,
  locating,
  onLocate,
}: {
  t: T;
  lang: Lang;
  areas: Area[];
  /** the list of areas has arrived */
  ready: boolean;
  /** the district the listing already has, kept when no area is chosen */
  keepDistrict?: string;
  areaId: string;
  onArea: (id: string) => void;
  area: Area | null;
  located: { lat: number; lng: number } | null;
  locating: boolean;
  onLocate: () => void;
}) {
  const name = (a: Area) => `${lang === 'bn' ? a.nameBn : a.nameEn}, ${a.district}`;
  return (
    <>
      <label htmlFor="area">{t('sell.field.area')}</label>
      <Select block id="area" value={areaId} onChange={(e) => onArea(e.target.value)} aria-describedby="area-hint">
        <option value="">{keepDistrict ? t('sell.area_keep', { district: keepDistrict }) : t('sell.area_choose')}</option>
        {areas.map((a) => (
          <option key={a.id} value={String(a.id)}>
            {name(a)}
          </option>
        ))}
      </Select>
      <p id="area-hint" className={styles.hint}>
        {t('sell.area_hint')}
      </p>
      <p>
        <Button variant="secondary" type="button" onClick={onLocate} disabled={locating || !ready} aria-busy={locating}>
          {t('sell.use_location')}
        </Button>
      </p>
      {located && area && <p className={styles.hint}>{t('sell.located', { area: name(area) })}</p>}
    </>
  );
}
