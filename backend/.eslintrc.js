// ESLint for the backend (NFR-MNT-07).
//
// Import boundaries (DC-1; docs/design/09_integration.pdf, sections 2.1 and 7.1): a unit module may
// import from another unit only that unit's ports (ports/) and its module class (<unit>.module),
// which NestJS needs to inject the ports. Its http/, services/, db/, events/, jobs/ and adapters/
// are private. The kernel never imports a unit.
const UNITS = ['identity', 'orders', 'listings', 'delivery', 'game-accounts', 'chat', 'trust'];

// Patterns use .gitignore syntax and are matched against the import path as written.
// "**/<unit>/*" forbids every entry of another unit's folder; the "!" lines re-allow its public surface.
const otherUnitInternals = (self) =>
  UNITS.filter((u) => u !== self).flatMap((u) => [
    `**/modules/${u}/*`,
    `!**/modules/${u}/ports`,
    `!**/modules/${u}/${u}.module`,
    // Relative imports between sibling units ("../../orders/...") do not contain "modules/".
    `../${u}/*`,
    `!../${u}/ports`,
    `!../${u}/${u}.module`,
    `../../${u}/*`,
    `!../../${u}/ports`,
    `!../../${u}/${u}.module`,
    `../../../${u}/*`,
    `!../../../${u}/ports`,
    `!../../../${u}/${u}.module`,
  ]);

const boundaryMessage =
  'DC-1: import another unit only through its ports/ or its module class, never its internal files.';

module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    ...UNITS.map((unit) => ({
      files: [`src/modules/${unit}/**/*.ts`],
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: [{ group: otherUnitInternals(unit), message: boundaryMessage }] },
        ],
      },
    })),
    {
      files: ['src/kernel/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/modules/**', '../modules/**', '../../modules/**'],
                message: 'The kernel never imports a unit module; units import the kernel.',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '.eslintrc.js'],
};
