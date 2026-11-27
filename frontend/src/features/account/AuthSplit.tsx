// The fresh page of sign-in and registration (U10-25, redesign v3): the whole screen is the ruled grid of GridCanvas, and the form, in the middle, is a ruled frame on it:
// its edges lie on the grid's lines (its width, height and place are whole cells), it is not filled and has no shadow, only hairlines and one hot rule
// on top. A step of the form (the password, the code) slides in and a ring of light runs out along the grid's lines.
// The page has no header, search, notices or footer (shared/Shell.tsx, BARE_PATHS); the logo and the language switch are in its corners.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { CARD_COLS, CELL, useViewport } from '../../shared/gridCell';
import { GridCanvas, pulseGrid, type Hole } from './GridCanvas';
import styles from './account.module.css';

/** The frame on the grid: the cell size, the card's width and place in whole cells (in the middle), its height rounded up to whole cells, and the cells it covers. */
function useFrame(content: RefObject<HTMLDivElement>, rows: number, stepKey: string, bands: number) {
  const { vw, vh } = useViewport();
  const [inner, setInner] = useState(0);
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    // the step's natural height. A banded step (heading band, form band, foot band): the heading and foot bands in whole cells (`bands`), the form's own
    // parts and a least gap of 10 px around each; the form band itself stretches to the card, so only its parts are read. Any other step: its flow plus the
    // step's own padding (the step stretches to the card too).
    const read = () => {
      if (bands > 0) {
        const form = el.querySelector('form') ?? el;
        const parts = Array.from(form.children) as HTMLElement[];
        const sum = parts.reduce((n, c) => n + c.offsetHeight, 0);
        setInner(bands * CELL + sum + (parts.length + 1) * 10);
        return;
      }
      const pad = el.parentElement ? getComputedStyle(el.parentElement) : null;
      setInner(el.offsetHeight + (pad ? parseFloat(pad.paddingTop) + parseFloat(pad.paddingBottom) : 0));
    };
    read();
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    watch?.observe(el);
    return () => watch?.disconnect();
  // each step is a new element (the key restarts its slide), so the measure follows the step
  }, [content, stepKey, bands]);
  const cell = CELL;
  const total = Math.floor(vw / cell);
  const cols = vw < 520 ? Math.max(8, Math.min(11, total - 2)) : Math.min(CARD_COLS, total - 2);
  const width = cols * cell;
  // a flow whose steps differ in height (sign-in: the number, the password, the code, each with or without an error) gives its card one height for all of
  // them (`rows`), so the card never grows or shrinks as the steps change; a step taller than that still fits
  const height = bands > 0 ? cell * rows : Math.max(cell * rows, Math.ceil((inner + 2) / cell) * cell);
  const leftCell = Math.max(1, Math.round((total - cols) / 2));
  // under the language switch (it is 44 px high at 20 px): on a phone the card starts below it with a clear gap
  const top = Math.max(cell * (vw < 520 || leftCell * cell < 256 ? 3 : 2), Math.round((vh - height) / 2 / cell) * cell);
  const hole = useMemo<Hole>(() => ({ x: leftCell, y: top / cell, w: cols, h: height / cell }), [leftCell, top, cols, height, cell]);
  return { cell, width, height, left: leftCell * cell, top, hole };
}

interface Props {
  children: ReactNode;
  stepKey?: string;
  rows?: number;
  /** A banded card (sign-in): the heading, the foot and their heights in whole cells; the children are the form between them. */
  head?: ReactNode;
  headCells?: number;
  foot?: ReactNode;
  footCells?: number;
}

export function AuthSplit({ children, stepKey = 'step', rows = 8, head, headCells = 3, foot, footCells = 2 }: Props) {
  const face = useRef<HTMLDivElement>(null);
  const slab = useRef<HTMLDivElement>(null);
  const banded = head !== undefined;
  const f = useFrame(face, rows, stepKey, banded ? headCells + footCells : 0);
  const { vw } = useViewport();
  const first = useRef(true);

  // the grid answers each step: a ring runs out from the middle of the slab (and on arrival, after the slab has risen)
  useEffect(() => {
    const send = () => { const b = slab.current?.getBoundingClientRect(); if (b) pulseGrid(b.left + b.width / 2, b.top + b.height / 2); };
    if (first.current) { first.current = false; const id = window.setTimeout(send, 380); return () => window.clearTimeout(id); }
    send();
    return undefined;
  }, [stepKey]);

  // one pixel more each way, so the frame's right and bottom hairlines lie on the grid's lines (which run on the cell's far edge)
  const style: CSSProperties & Record<string, string | number> = { marginLeft: f.left, width: f.width + 1, minHeight: f.height + 2, '--cell': `${f.cell}px` };
  return (
    <div className={styles.stage} style={{ paddingTop: f.top, paddingBottom: f.cell * (vw < 520 ? 1 : 3) }}>
      <GridCanvas cell={f.cell} hole={f.hole} />
      <div ref={slab} className={styles.stageCard} style={style}>
        {banded ? (
          <div key={stepKey} className={`${styles.stageStep} ${styles.banded}`} style={{ '--head': headCells, '--foot': footCells } as CSSProperties}>
            <div className={styles.bandHead}>{head}</div>
            <div ref={face} className={styles.bandBody}>{children}</div>
            <div className={styles.bandFoot}>{foot}</div>
          </div>
        ) : (
          <div key={stepKey} className={styles.stageStep}>
            <div ref={face} className={styles.stepFlow}>{children}</div>
          </div>
        )}
      </div>
    </div>
  );
}
