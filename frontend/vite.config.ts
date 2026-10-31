import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// docs/design/08_frontend.pdf, "Build and the Web Container". Four documents, each its own bundle (section 3.1):
// browser protections such as the CSP and the Permissions-Policy apply per document.
// In development, /api and /socket.io go to the backend, so cookies stay first-party (one origin).
const backend = process.env.VITE_BACKEND ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        staff: resolve(__dirname, 'staff.html'),
        kyc: resolve(__dirname, 'kyc.html'),
        secure: resolve(__dirname, 'secure.html'),
      },
    },
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
