import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// staff.html: the staff console, /staff/* and /admin/* (section 3.1). Staff code is never sent to
// users: src/staff/ may be imported only by this entry (eslint.config.js). Built in U8-10.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <h1>TrustBazaar staff</h1>
    </main>
  </StrictMode>,
);
