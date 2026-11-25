// The TrustBazaar theme for Mantine (docs/design/10_visual_v2.md, sections 2 to 6). Colours keep text contrast of at
// least 4.5:1 and control borders 3:1 (WCAG 2.2 AA, NFR-USE-06). Mantine's run-time <style> elements are off in
// every document (MANTINE_PROVIDER_PROPS); the CSS variables this theme gives are generated once into
// mantine-theme.css and shipped as a static file, so the pages keep style-src 'self' and Trusted Types (SEC-WEB-01;
// Decisions log, U10-01). theme.test.ts fails when the two drift apart.
import { createTheme, type MantineColorsTuple, type MantineProviderProps } from '@mantine/core';

/** Cobalt, the brand colour: shade 7 (#1D4ED8) is the main colour; white text on it is 8.9:1. */
const brand: MantineColorsTuple = ['#EEF3FF', '#DBE6FD', '#B9CDFB', '#8FACF7', '#6283F0', '#3C62E6', '#2A55DD', '#1D4ED8', '#1A3FB0', '#172E80'];
/** Teal-tinted greys from the paper to ink: 0 paper, 1 surface, 2 line, 5 control borders, 7 muted, 9 ink. */
const gray: MantineColorsTuple = ['#F5F7FB', '#EAEFF7', '#DBE2EE', '#BFC9DB', '#9AA7BE', '#6F7C92', '#5A667B', '#495466', '#2A3447', '#0B1220'];
/** Errors and auctions in their last hour: shade 6 (#B42318) is 6.2:1 on the paper. */
const red: MantineColorsTuple = ['#FEF3F2', '#FEE4E2', '#FECDCA', '#FDA29B', '#F97066', '#F04438', '#B42318', '#912018', '#7A271A', '#55160C'];

const FONT = "'Geist Variable', 'TB Figures', 'Hind Siliguri', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: 7,
  colors: { brand, gray, red },
  black: '#0B1220',
  white: '#FFFFFF',
  fontFamily: FONT,
  headings: {
    fontFamily: FONT,
    fontWeight: '650',
    sizes: {
      h1: { fontSize: '2.125rem', lineHeight: '1.1' },
      h2: { fontSize: '1.75rem', lineHeight: '1.15' },
      h3: { fontSize: '1.3125rem', lineHeight: '1.25' },
      h4: { fontSize: '1.0625rem', lineHeight: '1.35' },
    },
  },
  defaultRadius: 'md',
  radius: { xs: '6px', sm: '10px', md: '12px', lg: '18px', xl: '28px' },
  focusRing: 'auto',
  cursorType: 'pointer',
  respectReducedMotion: true,
  components: {
    Button: { defaultProps: { radius: 'xl', size: 'md' } },
    ActionIcon: { defaultProps: { radius: 'sm', variant: 'subtle', color: 'gray' } },
    TextInput: { defaultProps: { radius: 'md', size: 'md' } },
    PasswordInput: { defaultProps: { radius: 'md', size: 'md' } },
    Badge: { defaultProps: { radius: 'xl' } },
  },
});

/**
 * The provider's settings in every document: no run-time <style> (CSS variables and global classes come from the
 * static mantine-theme.css), and always the light scheme, so Mantine never touches the page's styles at run time.
 */
export const MANTINE_PROVIDER_PROPS = {
  theme,
  withCssVariables: false,
  withGlobalClasses: false,
  forceColorScheme: 'light',
} satisfies Partial<MantineProviderProps>;
