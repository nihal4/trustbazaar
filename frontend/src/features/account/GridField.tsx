// The side of sign-in and registration (U10-25, redesign v3, docs/design/10_visual_v3.md): a field of square cells drawn as hairlines, dense in the
// top corner and thinning out in steps, with a few cells lit in the hot colour and two offset squares as if a cell had been lifted out. It carries
// no picture and no data; it is drawn once from a fixed rule (no random numbers, so it never changes between visits) and hidden from readers.
const CELL = 64;
const COLS = 16;
const ROWS = 18;

/** A small fixed scatter, the same every time: 0, 1 or 2 from the cell's place. */
const jitter = (c: number, r: number) => ((c * 73856093) ^ (r * 19349663)) % 3;

const present = (c: number, r: number) => c * 0.62 + r * 0.8 + jitter(c, r) * 0.9 < 13.5;
const LIT = new Set(['2,2', '3,3', '5,2', '1,6', '6,5', '4,8']);
const FILLED = new Set(['3,3', '1,6']);

export function GridField() {
  const cells: { c: number; r: number }[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (present(c, r)) cells.push({ c, r });
  return (
    <svg viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`} preserveAspectRatio="xMaxYMin slice" width="100%" height="100%" aria-hidden="true" focusable="false" data-grid-field>
      {cells.map(({ c, r }) => {
        const key = `${c},${r}`;
        // drawn mirrored so the dense corner is the top right, towards the page edge
        const x = (COLS - 1 - c) * CELL;
        const lit = LIT.has(key);
        return <rect key={key} x={x + 0.5} y={r * CELL + 0.5} width={CELL - 1} height={CELL - 1} fill={FILLED.has(key) ? 'var(--tb-hot)' : 'none'} fillOpacity={FILLED.has(key) ? 0.1 : 0}
          stroke={lit ? 'var(--tb-hot)' : 'currentColor'} strokeOpacity={lit ? 0.85 : 1} vectorEffect="non-scaling-stroke" />;
      })}
      {/* two squares lifted half a cell out of the grid */}
      <rect x={(COLS - 6) * CELL + 28} y={4 * CELL - 12} width={CELL - 1} height={CELL - 1} fill="var(--tb-bg)" stroke="var(--tb-border)" vectorEffect="non-scaling-stroke" />
      <rect x={(COLS - 7) * CELL + 20} y={5 * CELL - 16} width={CELL - 1} height={CELL - 1} fill="var(--tb-bg)" stroke="var(--tb-border)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
