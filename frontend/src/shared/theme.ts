// The TrustBazaar theme for Mantine (docs/design/10_visual.md, sections 2 to 6). Colours keep text contrast of at
// least 4.5:1 and control borders 3:1 (WCAG 2.2 AA, NFR-USE-06). Mantine's run-time <style> elements are off in
// every document (MANTINE_PROVIDER_PROPS); the CSS variables this theme gives are generated once into
// mantine-theme.css and shipped as a static file, so the pages keep style-src 'self' and Trusted Types (SEC-WEB-01;
// Decisions log, U10-01). theme.test.ts fails when the two drift apart.
import { createTheme, type MantineColorsTuple, type MantineProviderProps } from '@mantine/core';

/** Plum: shade 7 (#4B2378) is the main colour; white text on it is 11.6:1. */
const plum: MantineColorsTuple = ['#F6F1FB', '#E9DDF6', '#D3BCEC', '#B996DF', '#9C71CF', '#7E50BC', '#64379F', '#4B2378', '#3A1A5E', '#2A1245'];
/** Lilac greys from the page background to ink: 1 mist, 2 line, 5 control borders, 6 subtle, 7 muted, 9 ink. */
const gray: MantineColorsTuple = ['#FAF9FB', '#F3F1F5', '#E6E1EC', '#D6D0DE', '#B7AFC2', '#857D92', '#706A7C', '#625C6E', '#3A3346', '#1E1A26'];
/** Errors and auctions in their last hour: shade 6 (#B42318) is 6.6:1 on white. */
const red: MantineColorsTuple = ['#FEF3F2', '#FEE4E2', '#FECDCA', '#FDA29B', '#F97066', '#F04438', '#B42318', '#912018', '#7A271A', '#55160C'];
const peach: MantineColorsTuple = ['#FFF6F1', '#FFF1EA', '#FFE3D5', '#FFD5C1', '#FFC9B0', '#F5A985', '#E08A62', '#B86742', '#8E4B2D', '#62301B'];

const FONT = "'Schibsted Grotesk Variable', 'Hind Siliguri', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const theme = createTheme({
  primaryColor: 'plum',
  primaryShade: 7,
  colors: { plum, gray, red, peach },
  black: '#1E1A26',
  white: '#FFFFFF',
  fontFamily: FONT,
  headings: {
    fontFamily: FONT,
    fontWeight: '800',
    sizes: {
      h1: { fontSize: '2.125rem', lineHeight: '1.1' },
      h2: { fontSize: '1.75rem', lineHeight: '1.15' },
      h3: { fontSize: '1.3125rem', lineHeight: '1.25' },
      h4: { fontSize: '1.0625rem', lineHeight: '1.35' },
    },
  },
  defaultRadius: 'md',
  radius: { xs: '6px', sm: '8px', md: '12px', lg: '18px', xl: '28px' },
  focusRing: 'auto',
  cursorType: 'pointer',
  respectReducedMotion: true,
  components: {
    Button: { defaultProps: { radius: 'xl', size: 'md' } },
    ActionIcon: { defaultProps: { radius: 'xl', variant: 'subtle', color: 'gray' } },
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
