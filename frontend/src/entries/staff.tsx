import { createRoot } from 'react-dom/client';
import { createDocument, DocumentRoot } from '../shared/document';
import { DocumentTitle } from '../shared/pages';
import '../shared/tokens.css';

// staff.html: the staff console, /staff/* and /admin/* (section 3.1). Staff code is never sent to
// users: src/staff/ may be imported only by this entry (eslint.config.js). It has the staff API client
// with its own cookies and refresh path (I-51 a). The queues, case files and the staff sign-in arrive
// in U8-10; until then an ended session shows the notice in place.
const doc = createDocument({
  kind: 'staff',
  titleKey: 'shell.document.staff',
  home: { path: '/staff', sameDocument: true },
  routes: [
    { path: '/staff/*', element: <DocumentTitle titleKey="shell.document.staff" /> },
    { path: '/admin/*', element: <DocumentTitle titleKey="shell.document.staff" /> },
  ],
});

createRoot(document.getElementById('root')!).render(<DocumentRoot doc={doc} />);
