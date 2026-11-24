// The production build served as the web container serves it (U8-11), for the end-to-end runs where the Compose
// system is not available: the routes of docs/design/web/container/nginx.conf, each document's headers read from its
// include file (so the policies are exactly the container's), its compression, /healthz, and /api and /socket.io
// passed to the backend.
//
//   E2E_API=http://127.0.0.1:3100 node e2e/serve.mjs      (port E2E_WEB_PORT, default 8080)
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { createGzip } from 'node:zlib';
import net from 'node:net';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const conf = join(here, '..', '..', 'docs', 'design', 'web', 'container', 'tb');
const api = new URL(process.env.E2E_API ?? 'http://127.0.0.1:3100');
const port = Number(process.env.E2E_WEB_PORT ?? 8080);

/** The add_header lines of an nginx include file, as [name, value] pairs. */
export function headersOf(file) {
  return [...readFileSync(file, 'utf8').matchAll(/^\s*add_header\s+([\w-]+)\s+("([^"]*)"|(\S+))\s+always;/gm)].map((m) => [m[1], m[3] ?? m[4]]);
}
const HEADERS = Object.fromEntries(['app', 'kyc', 'secure', 'staff'].map((d) => [d, headersOf(join(conf, `${d}-headers.conf`))]));
const ASSET_HEADERS = [['Cache-Control', 'public, max-age=31536000, immutable'], ['X-Content-Type-Options', 'nosniff'], ['Cross-Origin-Resource-Policy', 'same-origin']];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };

/** Which file and which headers nginx.conf gives a path (its location blocks, in nginx's matching order). */
export function route(path) {
  if (path.startsWith('/assets/')) return { file: path, headers: ASSET_HEADERS, missing404: true };
  if (path === '/staff' || path === '/admin' || path.startsWith('/staff/') || path.startsWith('/admin/') || path === '/staff.html') return { file: '/staff.html', headers: HEADERS.staff };
  if (path === '/account/kyc' || path.startsWith('/account/kyc/') || path === '/kyc.html') return { file: '/kyc.html', headers: HEADERS.kyc };
  if (path.startsWith('/secure/') || path === '/secure.html') return { file: '/secure.html', headers: HEADERS.secure };
  const listing = /^\/listings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/.exec(path);
  if (listing) return { file: '/index.html', headers: [...HEADERS.app, ['Link', `</api/v1/listings/${listing[1]}>; rel=preload; as=fetch; crossorigin=anonymous`]] };
  const own = normalize(path);
  const isFile = own !== '/' && existsSync(join(dist, own)) && statSync(join(dist, own)).isFile();
  return { file: isFile ? own : '/index.html', headers: HEADERS.app };
}

function proxy(req, res) {
  const out = http.request({ host: api.hostname, port: api.port, method: req.method, path: req.url, headers: { ...req.headers, host: req.headers.host, 'x-forwarded-for': req.socket.remoteAddress ?? '' } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.on('error', () => res.destroy());
    r.pipe(res);
  });
  out.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.on('error', () => out.destroy()); // the browser gave up on the request (a navigation, an aborted fetch)
  res.on('close', () => out.destroy());
  req.pipe(out);
}

const server = http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (path.startsWith('/api/') || path.startsWith('/socket.io/')) return proxy(req, res);
  if (path === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok\n'); }
  const r = route(path);
  const file = join(dist, normalize(r.file));
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const headers = Object.fromEntries(r.headers);
  headers['Content-Type'] = TYPES[extname(file)] ?? 'application/octet-stream';
  // gzip as nginx.conf's gzip_types and gzip_min_length say
  const gzip = /\.(js|css|svg|json|txt|html)$/.test(file) && statSync(file).size >= 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  if (gzip) { headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding'; }
  res.writeHead(200, headers);
  const stream = createReadStream(file).on('error', () => res.destroy());
  (gzip ? stream.pipe(createGzip({ level: 6 })) : stream).pipe(res);
});
// Socket.IO's WebSocket upgrade, piped through as nginx's proxy does
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(Number(api.port), api.hostname, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(port, () => console.log(`web on http://localhost:${port}, API ${api.origin}`));
