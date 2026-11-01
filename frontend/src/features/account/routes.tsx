// Routes of the account screens (section 3.3): /register, /signin, /reset and the two link pages for
// guests; /account and /account/security for signed-in users; the privacy and terms help pages. Each
// screen is a lazy chunk.
import type { RouteObject } from 'react-router-dom';

export const accountRoutes: RouteObject[] = [
  { path: '/register', lazy: () => import('./RegisterPage') },
  { path: '/signin', lazy: () => import('./SignInPage') },
  { path: '/reset', lazy: () => import('./ResetPage') },
  { path: '/reset-password', lazy: () => import('./ResetPasswordPage') },
  { path: '/verify-email', lazy: () => import('./VerifyEmailPage') },
  { path: '/account', lazy: () => import('./AccountPage') },
  { path: '/account/security', lazy: () => import('./SecurityPage') },
  { path: '/help/privacy', lazy: async () => ({ Component: (await import('./HelpPages')).PrivacyPage }) },
  { path: '/help/terms', lazy: async () => ({ Component: (await import('./HelpPages')).TermsPage }) },
];
