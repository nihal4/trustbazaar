// Routes of the listing page (section 3.3): /listings/:id, for everyone; the listing editor /sell/new and /sell/:id
// for verified sellers (U8-14).
import type { RouteObject } from 'react-router-dom';

export const listingRoutes: RouteObject[] = [
  { path: '/listings/:id', lazy: () => import('./ListingPage') },
  { path: '/sell/new', lazy: () => import('./SellPage') },
  { path: '/sell/:id', lazy: () => import('./SellPage') },
];
