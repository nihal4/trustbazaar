// Stylelint for the web client (U11-01). The point is the design system: a colour or a font is never written in a stylesheet, it comes from a token (--tb-*, shared/tokens.css), so
// that changing it once changes it everywhere. The colour and font rule is an ERROR (clean since U11-03); the other rules are warnings that become errors as each part is cleaned.
export default {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-declaration-strict-value'],
  defaultSeverity: 'warning',
  ignoreFiles: ['dist/**', 'storybook-static/**', 'node_modules/**', 'src/shared/mantine*.css'],
  rules: {
    // the design system: colours and fonts come from tokens (var(--tb-…)); transparent, currentColor and the like are allowed
    'scale-unlimited/declaration-strict-value': [
      ['/color$/', 'fill', 'stroke', 'font-family'],
      {
        ignoreValues: [
          // the system colours of forced-colors (high contrast) mode: the one place a colour is not ours to choose
          'CanvasText',
          'Canvas',
          'Highlight',
          'HighlightText',
          'ButtonText',
          'transparent',
          'currentColor',
          'currentcolor',
          'inherit',
          'initial',
          'unset',
          'none',
          'auto',
          'revert',
          '0',
          '/^color-mix\\(/',
        ],
        disableFix: true,
        severity: 'error', // clean since U11-03: a raw colour or font in a stylesheet fails the build
        message: 'Use a design token (var(--tb-…)) for "${property}", not "${value}".',
      },
    ],
    // CSS modules: class names are camelCase; keyframes too
    'selector-class-pattern': null,
    'keyframes-name-pattern': null,
    // the stylistic rules of the standard config that the codebase does not follow yet: formatting is Prettier's and a folder at a time
    'color-function-notation': null,
    'alpha-value-notation': null,
    'selector-not-notation': null,
    'media-feature-range-notation': null,
    'declaration-block-no-redundant-longhand-properties': null,
    'shorthand-property-no-redundant-values': null,
    'rule-empty-line-before': null,
    'comment-empty-line-before': null,
    'declaration-empty-line-before': null,
    'at-rule-empty-line-before': null,
    'custom-property-empty-line-before': null,
    'no-descending-specificity': null,
    'comment-whitespace-inside': null,
    'property-no-vendor-prefix': null,
    'value-no-vendor-prefix': null,
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global'] }],
  },
};
