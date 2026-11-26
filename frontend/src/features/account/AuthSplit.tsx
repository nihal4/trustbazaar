// The fresh page of sign-in and registration (U10-25, redesign v3): the whole screen is the ruled grid of GridCanvas, and the form, in the middle, is a ruled frame on it:
// its edges lie on the grid's lines (its width, height and place are whole cells), it is not filled and has no shadow, only hairlines and one hot rule
// on top. A step of the form (the password, the code) slides in and a ring of light runs out along the grid's lines.
// The page has no header, search, notices or footer (shared/Shell.tsx, BARE_PATHS); the logo and the language switch are in its corners.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useAccountT } from './common';
import { CARD_COLS, CELL, useViewport } from '../../shared/gridCell';
import { GridCanvas, pulseGrid, type Hole } from './GridCanvas';
import styles from './account.module.css';

/** The frame on the grid: the cell size, the card's width and place in whole cells (in the middle), its height rounded up to whole cells, and the cells it covers. */
function useFrame(content: RefObject<HTMLDivElement>, rows: number) {
  const { vw, vh } = useViewport();
  const [inner, setInner] = useState(0);
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const read = () => setInner(el.offsetHeight);
    read();
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    watch?.observe(el);
    return () => watch?.disconnect();
  }, [content]);
  const cell = CELL;
  const total = Math.floor(vw / cell);
  const cols = vw < 520 ? Math.max(8, Math.min(11, total - 1)) : Math.min(CARD_COLS, total - 2);
  const width = cols * cell;
  // a flow whose steps differ in height (sign-in: the number, the password, the code, each with or without an error) gives its card one height for all of
  // them (`rows`), so the card never grows or shrinks as the steps change; a step taller than that still fits
  const height = Math.max(cell * rows, Math.ceil((inner + 2) / cell) * cell);
  const leftCell = Math.max(1, Math.round((total - cols) / 2));
  const top = Math.max(cell * 2, Math.round((vh - height) / 2 / cell) * cell);
  const hole = useMemo<Hole>(() => ({ x: leftCell, y: top / cell, w: cols, h: height / cell }), [leftCell, top, cols, height, cell]);
  return { cell, width, height, left: leftCell * cell, top, hole };
}

export function AuthSplit({ children, stepKey = 'step', rows = 8 }: { children: ReactNode; stepKey?: string; rows?: number }) {
  const face = useRef<HTMLDivElement>(null);
  const slab = useRef<HTMLDivElement>(null);
  const f = useFrame(face, rows);
  const first = useRef(true);

  // the grid answers each step: a ring runs out from the middle of the slab (and on arrival, after the slab has risen)
  useEffect(() => {
    const send = () => { const b = slab.current?.getBoundingClientRect(); if (b) pulseGrid(b.left + b.width / 2, b.top + b.height / 2); };
    if (first.current) { first.current = false; const id = window.setTimeout(send, 380); return () => window.clearTimeout(id); }
    send();
    return undefined;
  }, [stepKey]);

  // one pixel more each way, so the frame's right and bottom hairlines lie on the grid's lines (which run on the cell's far edge)
  const style: CSSProperties = { marginLeft: f.left, width: f.width + 1, minHeight: f.height + 1 };
  return (
    <div className={styles.stage} style={{ paddingTop: f.top, paddingBottom: f.cell * 3 }}>
      <GridCanvas cell={f.cell} hole={f.hole} />
      <div ref={slab} className={styles.stageCard} style={style}>
        <div ref={face} key={stepKey} className={styles.stageStep}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The line under the main button of sign-in and registration (AC-ACC-2): the human check is a short proof of work
 *  in the browser (SEC-ABU-02, shared/humanCheck.ts), never a puzzle. */
export function HumanCheckNote() {
  const { t } = useAccountT();
  return <p className={styles.humanCheck}>{t('human_check.note')}</p>;
}
