// The page behind sign-in and registration (U10-25, redesign v3): a field of small raised tiles drawn on a canvas, lit from the top left, each with its
// top, right and bottom faces. It is alive: a slow wave runs across it and single tiles pop up now and then; tiles near the pointer rise and glow in the
// hot colour and sink back behind it like a trail; a touch or a step of the form sends a ring across it from where it happened. The sign-in card stands
// on the same grid (AuthSplit snaps it to whole tiles). Dense towards the top right, thinning in steps towards the bottom left, from a fixed rule (no
// random numbers). Hidden from readers, takes no clicks. With "reduce motion" it is drawn once, flat and still.
import { useEffect, useRef } from 'react';

export const GRID_PULSE = 'tb-grid-pulse';
/** Sends a ring across the grid from a point of the window (a step of the form, a tap). */
export const pulseGrid = (x: number, y: number) => window.dispatchEvent(new CustomEvent(GRID_PULSE, { detail: { x, y } }));

const REACH = 190;          // pixels from the pointer within which tiles react
const GAP = 2;
const LIT = [[2, 2], [3, 3], [5, 2], [1, 6], [6, 5], [4, 8], [9, 1], [8, 6], [11, 3], [7, 9]];
const LEVELS = 16;

const jitter = (c: number, r: number) => Math.abs((c * 73856093) ^ (r * 19349663)) % 3;
const phaseOf = (c: number, r: number) => (Math.abs((c * 2654435761) ^ (r * 40503)) % 1000) / 1000;

type Rgb = [number, number, number];
const parse = (v: string, fallback: Rgb): Rgb => {
  const m = v.trim().match(/^#([0-9a-f]{6})$/i);
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : fallback;
};
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const css = (c: Rgb, k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;

export function GridCanvas({ cell }: { cell: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
    if (!ctx) return;                                   // no canvas (a test, an old browser): the page is just dark
    const g = ctx;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: Rgb) => parse(root.getPropertyValue(name), fallback);
    const ground = token('--tb-bg', [10, 17, 16]);
    const slab = token('--tb-sheet', [16, 26, 25]);
    const hot = token('--tb-hot', [255, 107, 53]);
    const edge = token('--tb-line', [42, 59, 54]);
    // the palette by heat: top, right and bottom faces, and the hairline of the top
    const top = Array.from({ length: LEVELS }, (_, i) => css(mix(slab, hot, (i / (LEVELS - 1)) * 0.5)));
    const right = Array.from({ length: LEVELS }, (_, i) => css(mix(mix(ground, slab, 0.35), hot, (i / (LEVELS - 1)) * 0.38)));
    const bottom = Array.from({ length: LEVELS }, (_, i) => css(mix(ground, hot, (i / (LEVELS - 1)) * 0.22), 0.8));
    const hair = Array.from({ length: LEVELS }, (_, i) => css(mix(edge, hot, i / (LEVELS - 1))));

    let w = 0, h = 0, cols = 0, rows = 0, dpr = 1;
    let heat = new Float32Array(0);
    let present = new Uint8Array(0);
    let lit = new Uint8Array(0);
    const pointer = { x: -1e4, y: -1e4, on: false };
    const pulses: { x: number; y: number; t0: number }[] = [];
    let raf = 0, last = 0;

    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const box = stage.getBoundingClientRect();
      w = Math.max(1, Math.round(box.width)); h = Math.max(1, Math.round(box.height));
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / cell) + 1; rows = Math.ceil(h / cell) + 1;
      heat = new Float32Array(cols * rows);
      present = new Uint8Array(cols * rows);
      lit = new Uint8Array(cols * rows);
      // dense in the top right, thinning in steps towards the bottom left: a tile exists while its distance from that corner is under a limit, measured on
      // the first screen so a long page does not fill up
      const vr = Math.ceil(window.innerHeight / cell);
      const limit = Math.max(cols, vr) * 1.18;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const fromRight = cols - 1 - c;
        present[r * cols + c] = fromRight * 0.7 + r * 0.85 + jitter(c, r) * 1.1 < limit ? 1 : 0;
      }
      for (const [lc, lr] of LIT) { const c = cols - 1 - lc; if (c >= 0 && lr < rows) lit[lr * cols + c] = 1; }
    };

    const draw = (t: number) => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const S = cell - GAP;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!present[i]) continue;
        const cx = c * cell + cell / 2, cy = r * cell + cell / 2;
        let wave = 0, pop = 0, ring = 0;
        if (!reduce) {
          wave = 1.8 * (0.5 + 0.5 * Math.sin(c * 0.5 + r * 0.32 - t / 620));                              // a slow wave across the field
          pop = Math.max(0, Math.sin(t / 1050 + phaseOf(c, r) * 6.2832) - 0.95) * 120;                    // now and then one tile stands up
          for (const p of pulses) {
            const age = (t - p.t0) / 1000;
            const d = Math.hypot(cx - p.x, cy - p.y);
            ring += Math.exp(-(((d - age * 760) / 70) ** 2)) * Math.max(0, 1 - age / 1.5) * 13;             // a ring running out from the point
          }
        }
        const breathe = lit[i] ? (reduce ? 1 : 0.45 + 0.55 * Math.sin(t / 900 + c + r)) : 0;
        const v = Math.min(1, Math.max(heat[i], breathe * 0.7, Math.min(1, pop / 9) * 0.45, Math.min(1, ring / 11) * 0.6));
        const lvl = Math.round(v * (LEVELS - 1));
        const e = 2.5 + wave + pop + ring + heat[i] * 15 + (lit[i] ? 2 : 0);       // how far the tile stands out of the ground
        const x = c * cell + GAP / 2, y = r * cell + GAP / 2;
        const tx = x - e, ty = y - e;                                              // its top face is shifted up and left; the sides show on the right and below
        g.fillStyle = right[lvl];
        g.beginPath(); g.moveTo(tx + S, ty); g.lineTo(x + S, y); g.lineTo(x + S, y + S); g.lineTo(tx + S, ty + S); g.closePath(); g.fill();
        g.fillStyle = bottom[lvl];
        g.beginPath(); g.moveTo(tx, ty + S); g.lineTo(tx + S, ty + S); g.lineTo(x + S, y + S); g.lineTo(x, y + S); g.closePath(); g.fill();
        g.fillStyle = top[lvl];
        g.fillRect(tx, ty, S, S);
        g.strokeStyle = hair[lvl];
        g.lineWidth = 1;
        g.strokeRect(tx + 0.5, ty + 0.5, S - 1, S - 1);
      }
      // retire the rings that have run their course
      while (pulses.length && (t - pulses[0].t0) / 1000 > 1.6) pulses.shift();
    };

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      if (now - last < 32) return;                                   // about 30 frames a second
      last = now;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!present[i]) continue;
        let target = 0;
        if (pointer.on) {
          const d = Math.hypot(c * cell + cell / 2 - pointer.x, r * cell + cell / 2 - pointer.y);
          target = d < REACH ? (1 - d / REACH) ** 1.4 : 0;           // a hill under the pointer
        }
        const next = Math.max(target, heat[i] * 0.93);               // up at once, down slowly: the trail
        heat[i] = next < 0.01 ? 0 : next;
      }
      draw(now);
    };

    const local = (e: { clientX: number; clientY: number }) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const move = (e: PointerEvent) => { const p = local(e); pointer.x = p.x; pointer.y = p.y; pointer.on = true; };
    const leave = () => { pointer.on = false; };
    const tap = (e: PointerEvent) => { if (!reduce) { const p = local(e); pulses.push({ x: p.x, y: p.y, t0: performance.now() }); } };
    const onPulse = (e: Event) => {
      const d = (e as CustomEvent<{ x: number; y: number }>).detail;
      if (reduce || !d) return;
      const p = local({ clientX: d.x, clientY: d.y });
      pulses.push({ x: p.x, y: p.y, t0: performance.now() });
    };
    const resize = () => { size(); draw(performance.now()); };
    const visible = () => { cancelAnimationFrame(raf); raf = 0; if (!document.hidden && !reduce) raf = requestAnimationFrame(step); };

    size();
    draw(0);
    if (!reduce) raf = requestAnimationFrame(step);
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    watch?.observe(stage);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', tap, { passive: true });
    document.addEventListener('pointerleave', leave);
    window.addEventListener('blur', leave);
    window.addEventListener('resize', resize);
    window.addEventListener(GRID_PULSE, onPulse);
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelAnimationFrame(raf);
      watch?.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', tap);
      document.removeEventListener('pointerleave', leave);
      window.removeEventListener('blur', leave);
      window.removeEventListener('resize', resize);
      window.removeEventListener(GRID_PULSE, onPulse);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [cell]);

  return <canvas ref={ref} aria-hidden="true" data-grid-canvas />;
}
