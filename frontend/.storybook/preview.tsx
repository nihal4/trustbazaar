// What every story is rendered in (U11-01): the same tokens and base styles as the app, the language provider, and two toolbar choices (theme and language) that set
// <html data-theme> and the language exactly as the app does, so a component is seen in dark and light, English and Bangla.
import type { Preview } from '@storybook/react-vite';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/shared/language/Language';
import { theme } from '../src/shared/theme';
import '../src/shared/kit.css';
import '../src/shared/tokens.css';

const preview: Preview = {
  parameters: { layout: 'padded', controls: { expanded: true }, a11y: { test: 'todo' }, backgrounds: { disable: true } },
  globalTypes: {
    theme: { description: 'Colour theme', toolbar: { title: 'Theme', icon: 'circlehollow', items: ['dark', 'light'], dynamicTitle: true } },
    lang: { description: 'Language', toolbar: { title: 'Language', icon: 'globe', items: ['en', 'bn'], dynamicTitle: true } },
  },
  initialGlobals: { theme: 'dark', lang: 'en' },
  decorators: [
    (Story, context) => {
      document.documentElement.dataset.theme = context.globals.theme === 'light' ? 'light' : 'dark';
      document.body.style.background = 'var(--tb-bg)';
      document.body.style.color = 'var(--tb-text)';
      return (
        <MantineProvider theme={theme} forceColorScheme="light">
          <LanguageProvider key={context.globals.lang} initial={context.globals.lang === 'bn' ? 'bn' : 'en'}>
            <MemoryRouter>
              <Story />
            </MemoryRouter>
          </LanguageProvider>
        </MantineProvider>
      );
    },
  ],
};
export default preview;
