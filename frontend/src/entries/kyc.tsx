import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// kyc.html: /account/kyc/*, the only document allowed to use the camera (SEC-WEB-02, FR-KYC-02;
// section 3.1). Built in U8-03.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <h1>TrustBazaar KYC</h1>
    </main>
  </StrictMode>,
);
