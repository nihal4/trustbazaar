// The TrustBazaar theme for Mantine (docs/design/10_visual_v2.md, sections 2 to 6). Colours keep text contrast of at
// least 4.5:1 and control borders 3:1 (WCAG 2.2 AA, NFR-USE-06). Mantine's run-time <style> elements are off in
// every document (MANTINE_PROVIDER_PROPS); the CSS variables this theme gives are generated once into
// mantine-theme.css and shipped as a static file, so the pages keep style-src 'self' and Trusted Types (SEC-WEB-01;
// Decisions log, U10-01). theme.test.ts fails when the two drift apart.
import { createTheme, type MantineColorsTuple, type MantineProviderProps } from '@mantine/core';

/** Ink, the action colour: shade 7 (#232323) is the main colour; white text on it is 8.9:1. */
const brand: MantineColorsTuple = ['#F3F3F3', '#E4E4E4', '#CFCFCF', '#A9A9A9', '#808080', '#5C5C5C', '#3A3A3A', '#232323', '#161616', '#0A0A0A'];
/** Teal-tinted greys from the paper to ink: 0 paper, 1 surface, 2 line, 5 control borders, 7 muted, 9 ink. */
const gray: MantineColorsTuple = ['#FFFFFF', '#F3F3F3', '#E4E4E4', '#C8C8C8', '#A4A4A4', '#8A8A8A', '#757575', '#686868', '#3A3A3A', '#232323'];
/** Errors and auctions in their last hour: shade 6 (#B42318) is 6.2:1 on the paper. */
const red: MantineColorsTuple = ['#FEF3F2', '#FEE4E2', '#FECDCA', '#FDA29B', '#F97066', '#F04438', '#B42318', '#912018', '#7A271A', '#55160C'];

const FONT = "'Figtree Variable', 'TB Figures', 'Hind Siliguri', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: 7,
  colors: { brand, gray, red },
  black: '#232323',
  white: '#FFFFFF',
  fontFamily: FONT,
  headings: {
    fontFamily: "'Gabarito Variable', 'TB Figures', 'Hind Siliguri', system-ui, sans-serif",
    fontWeight: '500',
    sizes: {
      h1: { fontSize: '2.125rem', lineHeight: '1.1' },
      h2: { fontSize: '1.75rem', lineHeight: '1.15' },
      h3: { fontSize: '1.3125rem', lineHeight: '1.25' },
      h4: { fontSize: '1.0625rem', lineHeight: '1.35' },
    },
  },
  defaultRadius: 'md',
  radius: { xs: '6px', sm: '8px', md: '10px', lg: '16px', xl: '24px' },
  focusRing: 'auto',
  cursorType: 'pointer',
  respectReducedMotion: true,
  components: {
    Button: { defaultProps: { radius: 'md', size: 'md' } },
    ActionIcon: { defaultProps: { radius: 'sm', variant: 'subtle', color: 'gray' } },
    TextInput: { defaultProps: { radius: 'md', size: 'md' } },
    PasswordInput: { defaultProps: { radius: 'md', size: 'md' } },
    Badge: { defaultProps: { radius: 'sm' } },
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
