// Routes of the notification centre (section 3.3): /notifications, for signed-in users.
import type { RouteObject } from 'react-router-dom';

export const notificationRoutes: RouteObject[] = [
  { path: '/notifications', lazy: () => import('./NotificationsPage') },
];
