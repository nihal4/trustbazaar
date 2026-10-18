// The web container's nginx configuration, tested for real: nginx serves four fixture documents
// built like the application (React 18, external script and stylesheet), proxies /api and
// /socket.io to a fake backend, and Chromium reports what each document was allowed to do.
import http from 'node:http';
import crypto from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const here = new URL('.', import.meta.url).pathname;
const cont = new URL('../container/', import.meta.url).pathname;
let pass = 0, fail = 0;
const check = (c, l) => { if (c) { pass++; console.log('PASS  ' + l); } else { fail++; console.log('FAIL  ' + l); } };

// ---------------------------------------------------------------- fake backend
const backend = http.createServer((req, res) => {
  if (req.url === '/api/v1/ping') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, viaProxy: Boolean(req.headers['x-forwarded-for']), host: req.headers.host }));
  }
  res.statusCode = 404; res.end();
});
backend.on('upgrade', (req, socket) => {            // a minimal WebSocket handshake and one text frame
  if (!req.url.startsWith('/socket.io/')) return socket.destroy();
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const msg = Buffer.from('hello through the proxy');
  socket.write(Buffer.concat([Buffer.from([0x81, msg.length]), msg]));
  socket.on('error', () => {});
});
await new Promise((r) => backend.listen(0, '127.0.0.1', r));

// ---------------------------------------------------------------- fixture build output
const tmp = mkdtempSync(join(tmpdir(), 'tb-web-'));
chmodSync(tmp, 0o755);                 // nginx workers run unprivileged and must read the files
const html = join(tmp, 'html');
mkdirSync(join(html, 'assets'), { recursive: true });
await build({ entryPoints: [join(here, 'fixture/app.jsx')], bundle: true, minify: true, format: 'esm',
  outfile: join(html, 'assets/app-3f9a1c.js'), define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
writeFileSync(join(html, 'assets/app-3f9a1c.css'), 'body { background: rgb(250, 250, 245); }\n');
for (const doc of ['index', 'staff', 'kyc', 'secure']) {
  writeFileSync(join(html, `${doc}.html`), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${doc}</title><link rel="stylesheet" href="/assets/app-3f9a1c.css">
<style>#inline-style-target { color: rgb(255, 0, 0); }</style>
<script>window.inlineRan = true;</script>
<script type="module" src="/assets/app-3f9a1c.js"></script></head>
<body><p id="inline-style-target">x</p><div id="root"></div></body></html>`);
}

// ---------------------------------------------------------------- nginx with the reference configuration
const port = 18000 + Math.floor(Math.random() * 1000);
cpSync(join(cont, 'tb'), join(tmp, 'tb'), { recursive: true });
const server = readFileSync(join(cont, 'nginx.conf'), 'utf8')
  .replaceAll('BACKEND', `127.0.0.1:${backend.address().port}`)
  .replace('listen       8080;', `listen       127.0.0.1:${port};`)
  .replace('/usr/share/nginx/html', html)
  .replaceAll('/etc/nginx/tb/', join(tmp, 'tb') + '/');
writeFileSync(join(tmp, 'server.conf'), server);
for (const d of ['body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) mkdirSync(join(tmp, 'temp', d), { recursive: true });
writeFileSync(join(tmp, 'nginx.conf'), `daemon off; worker_processes 1; error_log ${tmp}/error.log warn; pid ${tmp}/nginx.pid;
events { worker_connections 256; }
http { include /etc/nginx/mime.types; default_type application/octet-stream; access_log off;
  client_body_temp_path ${tmp}/temp/body; proxy_temp_path ${tmp}/temp/proxy; fastcgi_temp_path ${tmp}/temp/fastcgi;
  uwsgi_temp_path ${tmp}/temp/uwsgi; scgi_temp_path ${tmp}/temp/scgi;
  include ${tmp}/server.conf; }`);
const t = spawnSync('nginx', ['-t', '-p', tmp, '-c', join(tmp, 'nginx.conf')], { encoding: 'utf8' });
check(t.status === 0, 'nginx -t accepts the configuration');
const ng = spawn('nginx', ['-p', tmp, '-c', join(tmp, 'nginx.conf')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const origin = `http://localhost:${port}`;

// ---------------------------------------------------------------- headers
const head = async (p) => { const r = await fetch(origin + p); await r.arrayBuffer(); return r; };
if (process.env.DEBUG) for (const p of ['/', '/assets/app-3f9a1c.js', '/staff/queues/disputes']) {
  const r = await fetch(origin + p); console.log(p, r.status, r.headers.get('content-type'), (await r.text()).slice(0, 120).replace(/\n/g, ' '));
}
const cases = [
  ['/', 'index'], ['/listings/42', 'index'], ['/orders/7?tab=dispute', 'index'],
  ['/staff/queues/disputes', 'staff'], ['/admin/config', 'staff'],
  ['/account/kyc', 'kyc'], ['/account/kyc/selfie', 'kyc'], ['/account/kycx', 'index'],
  ['/secure/orders/7/credentials', 'secure'], ['/secure/orders/7/deliver', 'secure'],
];
const titles = {};
for (const [p, doc] of cases) {
  const r = await fetch(origin + p);
  const body = await r.text();
  titles[p] = body.match(/<title>(\w+)<\/title>/)?.[1];
}
check(cases.every(([p, d]) => titles[p] === d), 'every path is served by its document (10 paths, including deep links)');
const sec = await head('/secure/orders/7/credentials');
check(sec.headers.get('cache-control') === 'no-store', 'SEC-GAM-03 credential pages: Cache-Control no-store');
check(sec.headers.get('content-security-policy').startsWith("default-src 'none'"), 'credential pages: CSP starts from nothing allowed');
check(sec.headers.get('referrer-policy') === 'no-referrer', 'credential pages: no referrer');
const app = await head('/listings/42');
check(app.headers.get('cache-control') === 'no-cache', 'user app HTML is revalidated on every load, so a new release applies at once');
check(/frame-ancestors 'none'/.test(app.headers.get('content-security-policy')), "SEC-WEB-01 frame-ancestors 'none'");
check(app.headers.get('x-content-type-options') === 'nosniff', 'SEC-WEB-02 nosniff');
const asset = await head('/assets/app-3f9a1c.js');
check(asset.headers.get('cache-control') === 'public, max-age=31536000, immutable', 'hashed assets are cached for a year');
check(asset.headers.get('content-type').includes('javascript'), 'scripts are served as JavaScript');
const api = await head('/api/v1/ping');
check(api.headers.get('content-security-policy') === null, 'API responses carry the backend\'s headers, not a page policy');
check((await head('/assets/missing.js')).status === 404, 'a missing asset is 404, not the app page');
const hz = await fetch(origin + '/healthz');
check(hz.status === 200 && (await hz.text()) === 'ok\n', 'the health check answers without the backend');

// ---------------------------------------------------------------- what each document may do, in Chromium
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const reports = {};
const violations = {};
for (const p of ['/listings/42', '/staff/queues/disputes', '/account/kyc', '/secure/orders/7/credentials']) {
  const page = await browser.newPage();
  violations[p] = 0;
  page.on('console', (m) => { if (/Content Security Policy|Trusted Type/i.test(m.text())) violations[p]++; });
  await page.goto(origin + p);
  await page.waitForFunction(() => window.__report, null, { timeout: 10000 });
  reports[p] = await page.evaluate(() => window.__report);
  await page.click('#inc');
  reports[p].clicked = await page.textContent('#inc');
  await page.close();
}
const all = Object.values(reports);
check(all.every((r) => r.reactRendered && r.clicked === 'Clicked 1'), 'React 18 renders and handles events under every document\'s policy');
check(all.every((r) => r.styleProp), 'React style props still work (they are set through the CSSOM, which CSP allows)');
check(all.every((r) => r.stylesheetApplied), 'the built stylesheet applies');
check(all.every((r) => !r.inlineRan), 'SEC-WEB-01 an inline script never runs');
check(all.every((r) => r.inlineStyleBlocked), 'an inline <style> block is refused');
check(all.every((r) => r.innerHTMLBlocked), 'SEC-INP-03 Trusted Types: assigning HTML through innerHTML throws');
check(all.every((r) => r.evalBlocked), 'eval and new Function are refused');
check(Object.values(violations).every((n) => n >= 2), 'each refusal is reported as a policy violation');
check(reports['/account/kyc'].camera === true && ['/listings/42', '/staff/queues/disputes', '/secure/orders/7/credentials']
  .every((p) => reports[p].camera === false), 'SEC-WEB-02 only the KYC document may use the camera');
check(reports['/listings/42'].geolocation === true && ['/staff/queues/disputes', '/account/kyc', '/secure/orders/7/credentials']
  .every((p) => reports[p].geolocation === false), 'only the user app may ask for the location');
check(all.every((r) => r.api?.ok && r.api.viaProxy), 'the API is reached on the same origin, through the proxy');
check(all.every((r) => r.ws === 'hello through the proxy'), "the WebSocket upgrade passes the proxy and connect-src 'self'");

await browser.close();
ng.kill('SIGQUIT');
backend.close();
rmSync(tmp, { recursive: true, force: true });
const nv = spawnSync('nginx', ['-v'], { encoding: 'utf8' }).stderr.match(/nginx\/[\d.]+/)?.[0] ?? '?';
console.log(`\n${pass} checks passed, ${fail} failed (${nv}, Chromium ${browser.version()})`);
process.exit(fail ? 1 : 0);
