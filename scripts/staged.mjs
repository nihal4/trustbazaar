#!/usr/bin/env node
// Runs a checker on the staged files of one application (U11-01), from that application's own folder, so it uses that application's configuration.
// Used by lint-staged (package.json at the repository root): node scripts/staged.mjs <frontend|backend> <eslint|stylelint> <files...>
// A file that is not part of the checker's configuration (an ignored file) is skipped, not an error. Errors stop the commit; warnings do not (they are the report of the clean-up).
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

const [app, tool, ...files] = process.argv.slice(2);
const root = resolve(import.meta.dirname, '..');
const cwd = resolve(root, app);
const paths = files.map((f) => relative(cwd, resolve(root, f)));
const args = tool === 'eslint' ? ['eslint', '--no-warn-ignored', '--max-warnings=999999', ...paths] : ['stylelint', '--allow-empty-input', ...paths];
const run = spawnSync('npx', ['--no-install', ...args], { cwd, stdio: 'inherit' });
process.exit(run.status ?? 1);
