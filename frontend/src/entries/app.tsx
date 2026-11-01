import { createRoot } from 'react-dom/client';
import { accountRoutes } from '../features/account/routes';
import { checkoutRoutes } from '../features/checkout/routes';
import { listingRoutes } from '../features/listings/routes';
import { notificationRoutes } from '../features/notifications/routes';
import { orderRoutes } from '../features/orders/routes';
import { searchRoutes } from '../features/search/routes';
import { createDocument, DocumentRoot, signInHere } from '../shared/document';
import '../shared/tokens.css';

// index.html: the user app, every path not served by the other three documents
// (docs/design/08_frontend.pdf, sections 3.1 and 3.3). Each route is a lazy chunk (section 9); the
// features add their routes here as they are built (U8-02 onwards).
const doc = createDocument({
  kind: 'user',
  home: { path: '/', sameDocument: true },
  signIn: signInHere,
  accountLinks: true,
  routes: [
    ...searchRoutes,
    ...listingRoutes,
    ...checkoutRoutes,
    ...orderRoutes,
    ...accountRoutes,
    ...notificationRoutes,
  ],
});

createRoot(document.getElementById('root')!).render(<DocumentRoot doc={doc} />);
