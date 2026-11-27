/* Dependency rules of the web client (U11-01): who may import whom. ESLint (eslint.config.js) already forbids a feature importing another feature, staff code outside the staff
   entry and anything but the library in the credential document; these rules show the same picture as a graph and add two more: a cycle, and `shared/` importing a feature. */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'warn', comment: 'A cycle of imports makes code hard to follow and to move.', from: {}, to: { circular: true } },
    {
      name: 'shared-not-features',
      severity: 'warn',
      comment: 'shared/ is the layer under the features: it may not import from them or from the staff console.',
      from: { path: '^src/shared' },
      to: { path: '^src/(features|staff)/', pathNot: '\\.test\\.' },
    },
    {
      name: 'lib-is-plain',
      severity: 'warn',
      comment: 'lib/ is plain code (no React, no shared UI, no features).',
      from: { path: '^src/lib' },
      to: { path: '^src/(shared|features|staff)/' },
    },
    {
      name: 'no-test-in-production',
      severity: 'warn',
      comment: 'Production code does not import test code.',
      from: { path: '^src', pathNot: '\\.(test|stories)\\.|^src/testing' },
      to: { path: '\\.(test|stories)\\.|^src/testing' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.(test|stories)\\.(ts|tsx)$' },
    reporterOptions: { dot: { collapsePattern: 'node_modules/[^/]+' } },
  },
};
