// The staff console's document (staff.html): the operator and administrator screens, with the staff session and none of the member app's code.
import { createRoot } from 'react-dom/client';
import { createDocument, DocumentRoot } from '../shared/document';
import { staffRoutes, staffSignIn } from '../staff/routes';
import '../shared/tokens.css';

// staff.html: the staff console, /staff/* and /admin/* (section 3.1; U8-10). Staff code is never sent to users:
// src/staff/ may be imported only by this entry (eslint.config.js). It has the staff API client with its own cookies
// and refresh path (I-51 a); an ended session goes to the staff sign-in and comes back afterwards.
const doc = createDocument({
  kind: 'staff',
  titleKey: 'shell.document.staff',
  home: { path: '/staff', sameDocument: true },
  signIn: staffSignIn,
  routes: staffRoutes,
});

createRoot(document.getElementById('root')!).render(<DocumentRoot doc={doc} />);
