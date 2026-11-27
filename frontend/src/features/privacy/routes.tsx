// Routes of the privacy screens (section 3.3): /account/privacy, the data export and account closure (FR-PRV; U8-09).
import type { RouteObject } from 'react-router-dom';

export const privacyRoutes: RouteObject[] = [{ path: '/account/privacy', lazy: () => import('./PrivacyPage') }];
