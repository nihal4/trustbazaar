import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// index.html: the user app, every path not served by the other three documents
// (docs/design/08_frontend.pdf, section 3.1). The shell, router and lib/ arrive with U8-01.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <h1>TrustBazaar</h1>
    </main>
  </StrictMode>,
);
