// Merges the parts of the inventory harvest (docs/design/11_inventory/parts/*.json, one per screen or open state) into one list of variants: the same measurements are one variant, with
// the number of components that have them, the screens they are on, the class names that make them and the picture of one example. Used by build-report.mjs.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function mergeParts(dir) {
  const variants = new Map();
  for (const file of readdirSync(join(dir, 'parts')).sort()) {
    for (const v of JSON.parse(readFileSync(join(dir, 'parts', file), 'utf8'))) {
      const key = `${v.category}::${JSON.stringify(v.signature)}`;
      const known = variants.get(key);
      if (!known) { variants.set(key, { ...v, screens: [...v.screens] }); continue; }
      known.count += v.count;
      for (const s of v.screens) if (!known.screens.includes(s)) known.screens.push(s);
      known.classes = [...new Set([...known.classes, ...v.classes])].slice(0, 10);
      if (!known.text && v.text) known.text = v.text;
      if (!known.picture && v.picture && existsSync(join(dir, 'crops', v.picture))) { known.picture = v.picture; known.id = v.id; }
    }
  }
  return [...variants.values()].sort((a, b) => a.category.localeCompare(b.category) || b.count - a.count);
}
