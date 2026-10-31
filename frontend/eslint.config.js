// ESLint for the web client (NFR-MNT-07). The rules that carry design decisions
// (docs/design/08_frontend.pdf, sections 3.2 and 8.2; docs/design/09_integration.pdf, section 7.1):
//   - text only: no dangerouslySetInnerHTML, no innerHTML or similar sinks (SEC-INP-03)
//   - browser storage only in the modules the design allows (SEC-SES-03)
//   - a feature never imports another feature's internals; links between features go through routes
//   - staff code only in the staff entry, so it is never sent to users (FR-OPS-04)
//   - the credentials document stays minimal: no React, features or shared code (SEC-GAM-03)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import globals from 'globals';

const FEATURES = [
  'account', 'kyc', 'listings', 'search', 'auctions', 'checkout', 'orders', 'delivery', 'game',
  'chat', 'notifications', 'disputes', 'ratings', 'seller', 'privacy',
];

// Patterns use .gitignore syntax, matched against the import path as written.
const intoFolder = (name) => [
  `**/${name}`, `**/${name}/**`,
  `../${name}`, `../${name}/**`, `../../${name}`, `../../${name}/**`, `../../../${name}`, `../../../${name}/**`,
];

const staffOnly = {
  group: intoFolder('staff'),
  message: 'FR-OPS-04: staff code (src/staff/) may be imported only by the staff entry.',
};
const notOtherFeatures = (self) => ({
  group: FEATURES.filter((f) => f !== self).flatMap((f) => [`**/features/${f}`, `**/features/${f}/**`, ...intoFolder(f).slice(2)]),
  message: 'Unit 8 section 3.2: a feature may not import another feature; link to its route instead.',
});
const secureMinimal = {
  group: ['react', 'react-dom', 'react-dom/*', 'react-router-dom', ...intoFolder('features'), ...intoFolder('shared')],
  message: 'SEC-GAM-03: the credentials document carries sealed.js and nothing else.',
};
const restrict = (...patterns) => ['error', { patterns }];

export default tseslint.config(
  // src/lib holds the Unit 8 reference modules, copied unchanged and tested by the reference-browser job.
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'src/lib/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { react },
    settings: { react: { version: '18.3' } },
    rules: {
      'react/no-danger': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
          message: 'SEC-INP-03: user text is plain text; set textContent or render React text.',
        },
        {
          selector: 'CallExpression[callee.property.name=/^(insertAdjacentHTML|createContextualFragment)$/]',
          message: 'SEC-INP-03: no HTML strings in the page.',
        },
        {
          selector: 'MemberExpression[object.name="document"][property.name=/^(write|writeln)$/]',
          message: 'SEC-INP-03: no HTML strings in the page.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'SEC-SES-03: browser storage only in the modules Unit 8 allows.' },
        { name: 'sessionStorage', message: 'SEC-SES-03: browser storage only in the modules Unit 8 allows.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'localStorage', message: 'SEC-SES-03: browser storage only in the modules Unit 8 allows.' },
        { object: 'window', property: 'sessionStorage', message: 'SEC-SES-03: browser storage only in the modules Unit 8 allows.' },
      ],
    },
  },
  // Import boundaries. Flat config replaces a rule's options per matching block, so each block
  // repeats the patterns that also apply to it.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/staff/**', 'src/entries/staff.tsx'],
    rules: { 'no-restricted-imports': restrict(staffOnly) },
  },
  ...FEATURES.map((feature) => ({
    files: [`src/features/${feature}/**/*.{ts,tsx}`],
    rules: { 'no-restricted-imports': restrict(staffOnly, notOtherFeatures(feature)) },
  })),
  {
    files: ['src/entries/secure.tsx'],
    rules: { 'no-restricted-imports': restrict(staffOnly, secureMinimal) },
  },
  {
    files: ['*.config.{js,ts}', 'src/**/*.test.ts'],
    languageOptions: { globals: globals.node },
  },
);
