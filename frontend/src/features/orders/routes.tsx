// Routes of orders (section 3.3): /orders, the member's orders as buyer or seller, and /orders/:id, the order view
// for the parties (U8-05 built its payment part; U8-06 the rest).
import type { RouteObject } from 'react-router-dom';

export const orderRoutes: RouteObject[] = [
  { path: '/orders', lazy: () => import('./OrdersPage') },
  { path: '/orders/:id', lazy: () => import('./OrderPage') },
];
