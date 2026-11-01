// Routes of checkout (section 3.3): /checkout/:listingId for verified members; a guest is sent to sign in.
import type { RouteObject } from 'react-router-dom';

export const checkoutRoutes: RouteObject[] = [
  { path: '/checkout/:listingId', lazy: () => import('./CheckoutPage') },
];
