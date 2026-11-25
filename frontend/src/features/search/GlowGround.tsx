// A moving gradient ground for the home hero (docs/design/10_visual_v3.md, section 3; taste-skill "gradient-mesh" with
// grain). Raw WebGL, no library: one full-screen triangle and one fragment shader. It starts after the load event, so the
// hero's text is the largest paint; the CSS gradient under it is the still fallback (no WebGL, reduced motion, context
// lost). It pauses when off screen or the tab is hidden, caps the pixel ratio, and follows the pointer with a soft light.
import { useEffect, useRef } from 'react';
import { afterLoad } from '../../shared/language/font';
import styles from './glow.module.css';

const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
const FRAG = `precision mediump float;
uniform vec2 r; uniform float t; uniform vec2 m; uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  vec2 uv = gl_FragCoord.xy / r; vec2 p = uv * vec2(r.x / r.y, 1.0) * 1.7;
  float a = n(p + vec2(t * 0.05, t * 0.03));
  float b = n(p * 1.7 - vec2(t * 0.04, -t * 0.06) + a * 1.6);
  vec3 col = mix(c0, c1, smoothstep(0.15, 0.85, b));
  col = mix(col, c2, smoothstep(0.5, 0.95, n(p * 0.8 + b + vec2(0.0, t * 0.02))) * 0.9);
  col += c3 * 0.30 * smoothstep(0.5, 0.0, distance(uv * vec2(r.x / r.y, 1.0), m * vec2(r.x / r.y, 1.0)));
  col += (h(gl_FragCoord.xy + t) - 0.5) * 0.05;
  gl_FragColor = vec4(col, 1.0);
}`;
const hex = (s: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number];
const FALLBACK = ['#0A1018', '#15263B', '#FF6B35', '#FFB08A'];
/** the shader's colours come from the --tb-glow-0 to -3 tokens, so the palette lives in tokens.css only */
const colours = (): string[] => FALLBACK.map((d, i) => { const v = getComputedStyle(document.documentElement).getPropertyValue(`--tb-glow-${i}`).trim(); return /^#[0-9a-f]{6}$/i.test(v) ? v : d; });

export function GlowGround({ area }: { area: React.RefObject<HTMLElement> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let raf = 0;
    let dispose = () => {};
    const cancelled = { v: false };
    afterLoad(() => {
      if (cancelled.v) return;
      const gl = c.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
      if (!gl) return;   // the CSS gradient stays
      const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const u = (name: string) => gl.getUniformLocation(prog, name);
      colours().forEach((col, i) => gl.uniform3fv(u(`c${i}`), hex(col)));
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const pointer = { x: 0.7, y: 0.6, tx: 0.7, ty: 0.6 };
      let visible = true;
      const size = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; gl.viewport(0, 0, w, h); }
      };
      const draw = (time: number) => {
        size();
        pointer.x += (pointer.tx - pointer.x) * 0.06; pointer.y += (pointer.ty - pointer.y) * 0.06;
        gl.uniform2f(u('r'), c.width, c.height); gl.uniform1f(u('t'), time); gl.uniform2f(u('m'), pointer.x, pointer.y);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      const frame = (ms: number) => { if (visible && !document.hidden) draw(ms / 1000); raf = requestAnimationFrame(frame); };
      const move = (e: PointerEvent) => { const b = c.getBoundingClientRect(); pointer.tx = (e.clientX - b.left) / b.width; pointer.ty = 1 - (e.clientY - b.top) / b.height; };
      const host = area.current;
      const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; });
      io.observe(c);
      const lost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); };
      c.addEventListener('webglcontextlost', lost);
      if (reduced) { draw(2.5); c.dataset.live = 'still'; } else { host?.addEventListener('pointermove', move); raf = requestAnimationFrame(frame); c.dataset.live = 'moving'; }
      dispose = () => { cancelAnimationFrame(raf); io.disconnect(); host?.removeEventListener('pointermove', move); c.removeEventListener('webglcontextlost', lost); gl.getExtension('WEBGL_lose_context')?.loseContext(); };
    });
    return () => { cancelled.v = true; dispose(); };
  }, [area]);
  return <canvas ref={canvas} className={styles.ground} aria-hidden="true" />;
}
