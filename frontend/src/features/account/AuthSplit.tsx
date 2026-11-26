// The fresh page of sign-in and registration (U10-25, redesign v3): the whole screen is the ruled grid of GridCanvas, and the form is a ruled frame on it:
// its edges lie on the grid's lines (its width, height and place are whole cells), it is not filled and has no shadow, only hairlines and one hot rule
// on top. A step of the form (the password, the code) slides in and a ring of light runs out along the grid's lines.
// The page has no header, search, notices or footer (shared/Shell.tsx, BARE_PATHS); the logo and the language switch are in its corners.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useAccountT } from './common';
import { GridCanvas, pulseGrid } from './GridCanvas';
import styles from './account.module.css';

/** The frame on the grid: the cell size, the width and the place in whole cells, and the height rounded up to whole cells. */
function useFrame(content: RefObject<HTMLDivElement>) {
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  const [inner, setInner] = useState(0);
  useEffect(() => {
    const on = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const read = () => setInner(el.offsetHeight);
    read();
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    watch?.observe(el);
    return () => watch?.disconnect();
  }, [content]);
  const small = vw < 520;
  const cell = small ? 32 : 40;
  const cols = small ? Math.max(8, Math.min(11, Math.floor(vw / cell) - 1)) : 13;
  const width = cols * cell;
  const height = Math.max(cell * 8, Math.ceil((inner + 2) / cell) * cell);
  const left = Math.max(cell, Math.round((vw - width) / 2 / cell) * cell);
  const topFree = Math.round((vh - height) / 2 / cell) * cell;
  const top = Math.max(cell * 2, topFree);
  return { cell, width, height, left, top };
}

export function AuthSplit({ children, stepKey = 'step' }: { children: ReactNode; stepKey?: string }) {
  const face = useRef<HTMLDivElement>(null);
  const slab = useRef<HTMLDivElement>(null);
  const f = useFrame(face);
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
      <GridCanvas cell={f.cell} />
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
