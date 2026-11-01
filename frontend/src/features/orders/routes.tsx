// Routes of orders (section 3.3): /orders/:id for the parties. U8-05 builds its payment part (the provider returns
// here, Decisions log U2-03 and U8-05); U8-06 adds the full order view and /orders.
import type { RouteObject } from 'react-router-dom';

export const orderRoutes: RouteObject[] = [
  { path: '/orders/:id', lazy: () => import('./OrderPage') },
];
