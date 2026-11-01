// Routes of kyc.html (section 3.1): /account/kyc and below, all the wizard.
import type { RouteObject } from 'react-router-dom';

export const kycRoutes: RouteObject[] = [
  { path: '/account/kyc/*', lazy: () => import('./KycPage') },
];
