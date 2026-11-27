#!/usr/bin/env node
// Which style is defined where (U11-13): reads every CSS module and lists, for each class name, the files and lines that define it and the properties that matter for how it looks. A name defined in
// several modules (.primary in nine, say) is a duplicated component. Writes docs/design/11_inventory/css-classes.json and prints the most repeated names.
//   node scripts/inventory/scan-css.mjs
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(root, '..', 'docs', 'design', '11_inventory');
const SHOWN = ['height', 'min-height', 'padding', 'padding-inline', 'border', 'border-radius', 'background', 'background-color', 'color', 'font-size', 'font-weight', 'box-shadow'];

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); } else if (name.endsWith('.module.css')) files.push(p);
  }
})(join(root, 'src'));

/** @type {Record<string, {file: string, line: number, selector: string, look: Record<string,string>}[]>} */
const classes = {};
for (const file of files) {
  postcss.parse(readFileSync(file, 'utf8'), { from: file }).walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) {
      const last = selector.trim().split(/[\s>+~]+/).pop() ?? '';
      const m = /^\.([A-Za-z][\w-]*)/.exec(last);
      if (!m) continue;
      const look = {};
      rule.walkDecls((d) => { if (SHOWN.includes(d.prop)) look[d.prop] = d.value; });
      (classes[m[1]] ??= []).push({ file: relative(root, file), line: rule.source?.start?.line ?? 0, selector: selector.trim(), look });
    }
  });
}

const summary = Object.entries(classes)
  .map(([name, defs]) => ({ name, definitions: defs.length, modules: [...new Set(defs.map((d) => d.file))].length, defs }))
  .sort((a, b) => b.modules - a.modules || b.definitions - a.definitions);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'css-classes.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`${files.length} CSS modules, ${summary.length} class names`);
console.log('class names defined in the most modules:');
for (const s of summary.slice(0, 25)) console.log(`  .${s.name}: ${s.modules} modules, ${s.definitions} definitions`);
