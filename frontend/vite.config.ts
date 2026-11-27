import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// docs/design/08_frontend.pdf, "Build and the Web Container". Four documents, each its own bundle (section 3.1):
// browser protections such as the CSP and the Permissions-Policy apply per document.
// In development, /api and /socket.io go to the backend, so cookies stay first-party (one origin).
const backend = process.env.VITE_BACKEND ?? 'http://localhost:3000';

// In development the other two documents are reached at their real addresses, as nginx serves them in the container
// (/account/kyc/* is kyc.html, /secure/* is secure.html); a page load of those paths is answered with the document.
const documentRoutes = {
  name: 'tb-document-routes',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string; headers: Record<string, string | undefined> }, res: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((req, _res, next) => {
      const path = (req.url ?? '').split('?')[0];
      const page = req.headers.accept?.includes('text/html');
      if (page && (path === '/account/kyc' || path.startsWith('/account/kyc/'))) req.url = '/kyc.html';
      else if (page && path.startsWith('/secure/')) req.url = '/secure.html';
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), documentRoutes],
  build: {
    target: 'es2020',
    // fonts stay files: the policy allows fonts only from the site (font-src 'self'), never as data: URLs, and the
    // small Bangla figures cuts (src/shared/language/figures) would otherwise be inlined (Decisions log, U10-20)
    assetsInlineLimit: (file: string) => (file.endsWith('.woff2') ? false : undefined),
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        staff: resolve(__dirname, 'staff.html'),
        kyc: resolve(__dirname, 'kyc.html'),
        secure: resolve(__dirname, 'secure.html'),
      },
    },
  },
  test: {
    setupFiles: ['src/testing/setup.ts'],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/socket.io': { target: backend, ws: true, changeOrigin: false },
    },
  },
});
