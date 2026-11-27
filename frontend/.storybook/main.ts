// Storybook for the web client (U11-01): a catalogue of the shared components (src/shared/ui and the rest of shared/) in every variant, size, language and theme, so a new developer can
// see what exists before writing another one. Stories sit next to their component as Component.stories.tsx.
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)', '../src/**/*.mdx'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: { name: '@storybook/react-vite', options: {} },
  staticDirs: ['../public'],
};
export default config;
