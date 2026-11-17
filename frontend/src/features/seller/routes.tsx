// Routes of the seller screens (section 3.3): /seller, the dashboard (IF-UI-08), and /account/payout, the payout
// account (FR-PAY-17). Verified members only; the server refuses others and the screens say why (U8-09).
import type { RouteObject } from 'react-router-dom';

export const sellerRoutes: RouteObject[] = [
  { path: '/seller', lazy: () => import('./SellerPage') },
  { path: '/account/payout', lazy: () => import('./PayoutAccountPage') },
];
