// The page behind sign-in and registration (U10-25, redesign v3): a field of hairline squares over the whole screen, dense in the top right corner and
// thinning out in steps towards the bottom left, with a few cells lit in the hot colour. It answers the pointer: cells near it light up and rise a few
// pixels, and the light fades behind it like a trail. Idle, the lit cells breathe slowly. No picture, no data; the shape comes from a fixed rule (no
// random numbers), so it is the same on every visit. It is hidden from readers and never takes a click. With "reduce motion" it is drawn once and
// still, and only the cell under the pointer is marked.
import { useEffect, useRef } from 'react';

const CELL = 64;
const REACH = 170;          // pixels from the pointer within which cells react
const LIT = [[2, 2], [3, 3], [5, 2], [1, 6], [6, 5], [4, 8], [9, 1], [8, 6]];

const jitter = (c: number, r: number) => Math.abs((c * 73856093) ^ (r * 19349663)) % 3;

export function GridCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
    if (!ctx) return;                                   // no canvas (a test, an old browser): the page is just dark
    const g = ctx;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const css = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const line = color('--tb-border', '#66807a');
    const hot = color('--tb-hot', '#ff6b35');
    const bg = color('--tb-bg', '#0a1110');

    let w = 0, h = 0, cols = 0, rows = 0, dpr = 1;
    let heat = new Float32Array(0);                     // each cell's light, 0 to 1, fading
    let present = new Uint8Array(0);
    const pointer = { x: -1e4, y: -1e4, on: false };
    let raf = 0, last = 0, running = false;

    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / CELL) + 1; rows = Math.ceil(h / CELL) + 1;
      heat = new Float32Array(cols * rows);
      present = new Uint8Array(cols * rows);
      // dense in the top right, thinning towards the bottom left: a cell exists while its distance (cells) from that corner is under a limit
      const limit = Math.max(cols, rows) * 0.95;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const fromRight = cols - 1 - c;
        present[r * cols + c] = fromRight * 0.78 + r * 0.9 + jitter(c, r) * 1.1 < limit ? 1 : 0;
      }
    };

    const draw = (t: number) => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.lineWidth = 1;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!present[i]) continue;
        const lit = LIT.some(([lc, lr]) => cols - 1 - lc === c && lr === r);
        const breathe = lit && !reduce ? 0.5 + 0.5 * Math.sin(t / 1400 + c + r) : lit ? 1 : 0;
        const v = Math.max(heat[i], breathe * 0.55);
        const x = c * CELL, y = r * CELL - heat[i] * 4;
        if (v > 0.02) { g.fillStyle = hot; g.globalAlpha = v * 0.22; g.fillRect(x + 1, y + 1, CELL - 2, CELL - 2); }
        g.globalAlpha = lit ? 0.5 + 0.5 * v : 0.32 + heat[i] * 0.6;
        g.strokeStyle = heat[i] > 0.05 || lit ? hot : line;
        if (heat[i] > 0.05 && !lit) g.globalAlpha = 0.25 + heat[i] * 0.7;
        g.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      }
      g.globalAlpha = 1;
    };

    const step = (now: number) => {
      raf = 0;
      if (now - last < 33) { raf = requestAnimationFrame(step); return; }   // about 30 frames a second is plenty for hairlines
      last = now;
      let any = false;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        let target = 0;
        if (pointer.on) {
          const dx = c * CELL + CELL / 2 - pointer.x, dy = r * CELL + CELL / 2 - pointer.y;
          const d = Math.hypot(dx, dy);
          target = d < REACH ? 1 - d / REACH : 0;
        }
        const next = Math.max(target, heat[i] * 0.92);     // light up at once, fade slowly: the trail
        heat[i] = next < 0.01 ? 0 : next;
        if (heat[i] > 0) any = true;
      }
      draw(now);
      if (any || pointer.on || !reduce) raf = requestAnimationFrame(step); else running = false;
    };
    const wake = () => { if (!running || !raf) { running = true; if (!raf) raf = requestAnimationFrame(step); } };

    const move = (e: PointerEvent) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = true; if (!reduce) wake(); else markStill(); };
    const leave = () => { pointer.on = false; if (!reduce) wake(); else { heat.fill(0); draw(0); } };
    // reduced motion: no trail, no idle: only the cell under the pointer is marked, on the move
    const markStill = () => {
      heat.fill(0);
      const c = Math.floor(pointer.x / CELL), r = Math.floor(pointer.y / CELL);
      if (c >= 0 && c < cols && r >= 0 && r < rows) heat[r * cols + c] = 1;
      draw(0);
    };
    const resize = () => { size(); draw(performance.now()); };
    const visible = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; running = false; } else if (!reduce) wake(); };

    size();
    g.fillStyle = bg;
    draw(0);
    if (!reduce) wake();
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', leave);
    window.addEventListener('blur', leave);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', leave);
      window.removeEventListener('blur', leave);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" data-grid-canvas />;
}
