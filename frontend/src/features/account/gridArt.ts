// What the grid draws on the sign-in page (U10-25): cells, not drawings. Only the name: TRUST over BAZAAR in a 3 by 5 letter face. A picture is a list of cell
// offsets and a kind: 'o' is drawn in the hot colour, 'w' in the pale colour of the logotype's "bazaar". Fixed data.
interface Cell {
  x: number;
  y: number;
  k: 'o' | 'w';
}
export interface Picture {
  cells: Cell[];
  w: number;
  h: number;
}

const LETTERS: Record<string, string[]> = {
  T: ['111', '010', '010', '010', '010'],
  R: ['110', '101', '110', '101', '101'],
  U: ['101', '101', '101', '101', '111'],
  S: ['011', '100', '010', '001', '110'],
  B: ['110', '101', '110', '101', '110'],
  A: ['010', '101', '111', '101', '101'],
  Z: ['111', '001', '010', '100', '111'],
};

const fromRows = (rows: string[], k: 'o' | 'w', dx = 0, dy = 0): Cell[] => {
  const out: Cell[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '#' || ch === '1') out.push({ x: x + dx, y: y + dy, k });
    }),
  );
  return out;
};

const word = (text: string, k: 'o' | 'w', dy: number): { cells: Cell[]; w: number } => {
  const cells: Cell[] = [];
  let x = 0;
  for (const ch of text) {
    cells.push(...fromRows(LETTERS[ch], k, x, dy));
    x += 4;
  }
  return { cells, w: x - 1 };
};

/** TRUST over BAZAAR, the first centred on the second: the name of the site, in the logotype's two colours. */
export function nameArt(): Picture {
  const a = word('TRUST', 'o', 0);
  const b = word('BAZAAR', 'w', 6);
  const shift = Math.floor((b.w - a.w) / 2);
  return { cells: [...a.cells.map((c) => ({ ...c, x: c.x + shift })), ...b.cells], w: b.w, h: 11 };
}
