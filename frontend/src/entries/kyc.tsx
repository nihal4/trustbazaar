import { createRoot } from 'react-dom/client';
import { createDocument, DocumentRoot, signInInUserApp } from '../shared/document';
import { kycRoutes } from '../features/kyc/routes';
import '../shared/tokens.css';

// kyc.html: /account/kyc/*, the only document allowed to use the camera (SEC-WEB-02, FR-KYC-02;
// section 3.1). It uses the user's session, so it has the user app's API client.
const doc = createDocument({
  kind: 'user',
  titleKey: 'shell.document.kyc',
  home: { path: '/', sameDocument: false },
  signIn: signInInUserApp,
  routes: kycRoutes,
});

createRoot(document.getElementById('root')!).render(<DocumentRoot doc={doc} />);
