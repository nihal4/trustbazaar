// Runs sealed.js in real Chromium (Playwright) and checks the properties Unit 5 relies on.
// usage: node browser_test.mjs   (after: npx esbuild sealed.js --bundle --format=iife --global-name=Sealed --outfile=sealed.bundle.js)
import http from "node:http";
import fs from "node:fs";
import { chromium } from "playwright";

const bundle = fs.readFileSync(new URL("./sealed.bundle.js", import.meta.url));
const server = http.createServer((req, res) => {
  if (req.url === "/sealed.bundle.js") { res.setHeader("content-type", "text/javascript"); return res.end(bundle); }
  res.setHeader("content-type", "text/html");
  res.end('<!doctype html><meta charset="utf-8"><script src="/sealed.bundle.js"></script>');
});
await new Promise((ok) => server.listen(8765, "127.0.0.1", ok));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("http://127.0.0.1:8765/");

const results = [];
const check = (label, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " (" + detail + ")" : ""}`); };
const ORDER = "d0000000-0000-4000-8000-000000000001";
const creds = { loginId: "player@example.com", password: "Correct-Horse-Battery-9", recovery: ["8F2K-11QX", "9Z3M-22RW"] };

// 1. key generation, non-extractability, storage
const k = await page.evaluate(async (ORDER) => {
  const { pair, publicRaw } = await Sealed.generateBuyerKey();
  let exportBlocked = false;
  try { await crypto.subtle.exportKey("pkcs8", pair.privateKey); } catch { exportBlocked = true; }
  let jwkBlocked = false;
  try { await crypto.subtle.exportKey("jwk", pair.privateKey); } catch { jwkBlocked = true; }
  await Sealed.storeKey(ORDER, 1, pair);
  return { pub: Array.from(publicRaw), extractable: pair.privateKey.extractable, exportBlocked, jwkBlocked, fp: await Sealed.fingerprint(publicRaw) };
}, ORDER);
check("FR-GAM-07 the private key is non-extractable", k.extractable === false && k.exportBlocked && k.jwkBlocked);
check("FR-GAM-07 the public key is a 65-byte uncompressed P-256 point", k.pub.length === 65 && k.pub[0] === 4);

// 2. the seller's browser (a separate page, as on another device) seals for that public key
const seller = await context.newPage();
await seller.goto("http://127.0.0.1:8765/");
const sealed = await seller.evaluate(async ({ pub, ORDER, creds }) => {
  const r = await Sealed.seal(new Uint8Array(pub), ORDER, 1, creds);
  return { enc: Array.from(r.enc), ct: Array.from(r.ciphertext), fp: await Sealed.fingerprint(new Uint8Array(pub)) };
}, { pub: k.pub, ORDER, creds });
check("FR-GAM-08 buyer and seller compute the same fingerprint independently", sealed.fp === k.fp, k.fp);
check("DV-34 ciphertext is 512 k + 16 bytes; enc is a 65-byte point",
  (sealed.ct.length - 16) % 512 === 0 && sealed.enc.length === 65 && sealed.enc[0] === 4, `${sealed.ct.length} bytes`);
fs.writeFileSync(new URL("./sealed_sample.json", import.meta.url), JSON.stringify({ publicKey: Buffer.from(k.pub).toString("hex"), enc: Buffer.from(sealed.enc).toString("hex"), ciphertext: Buffer.from(sealed.ct).toString("hex") }));
check("SEC-GAM-01 the ciphertext does not contain the password in clear",
  !Buffer.from(sealed.ct).includes(Buffer.from(creds.password)));

// 3. reload the buyer's page: the key survives in IndexedDB and opens the credentials
await page.reload();
const opened = await page.evaluate(async ({ ORDER, s }) => {
  const pair = await Sealed.loadKey(ORDER, 1);
  const out = await Sealed.open(pair, ORDER, 1, new Uint8Array(s.enc), new Uint8Array(s.ct));
  return { out, extractable: pair.privateKey.extractable };
}, { ORDER, s: sealed });
check("FR-GAM-11 after a reload the stored key (still non-extractable) opens the credentials",
  JSON.stringify(opened.out) === JSON.stringify(creds) && opened.extractable === false);

// 4. failures that must happen
const neg = await page.evaluate(async ({ ORDER, s }) => {
  const pair = await Sealed.loadKey(ORDER, 1);
  const tries = {};
  const t = async (name, f) => { try { await f(); tries[name] = false; } catch { tries[name] = true; } };
  const ct = new Uint8Array(s.ct); const tampered = ct.slice(); tampered[100] ^= 1;
  await t("tampered", () => Sealed.open(pair, ORDER, 1, new Uint8Array(s.enc), tampered));
  await t("otherOrder", () => Sealed.open(pair, "d0000000-0000-4000-8000-000000000002", 1, new Uint8Array(s.enc), ct));
  await t("otherVersion", () => Sealed.open(pair, ORDER, 2, new Uint8Array(s.enc), ct));
  const other = await Sealed.generateBuyerKey();
  await t("otherKey", () => Sealed.open(other.pair, ORDER, 1, new Uint8Array(s.enc), ct));
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  await t("tooLong", () => Sealed.seal(rawPub, ORDER, 1, { password: "x".repeat(5000) }));
  return tries;
}, { ORDER, s: sealed });
check("a modified ciphertext is rejected (AES-GCM tag)", neg.tampered);
check("ciphertext moved to another order is rejected (associated data)", neg.otherOrder);
check("ciphertext replayed under another key version is rejected", neg.otherVersion);
check("another browser's key cannot open it", neg.otherKey);
check("DV-34 credentials over 4 KB are refused before sealing", neg.tooLong);

// 5. length hiding and the shared fingerprint vector
const sizes = await seller.evaluate(async ({ pub, ORDER }) => {
  const a = await Sealed.seal(new Uint8Array(pub), ORDER, 1, { loginId: "a", password: "12345" });
  const b = await Sealed.seal(new Uint8Array(pub), ORDER, 1, { loginId: "a", password: "p".repeat(300) });
  const vec = new Uint8Array(65); vec[0] = 4; for (let i = 1; i < 65; i++) vec[i] = i;
  return { a: a.ciphertext.length, b: b.ciphertext.length, vec: await Sealed.fingerprint(vec),
           fresh: (await Sealed.seal(new Uint8Array(pub), ORDER, 1, { p: 1 })).enc.join() !== a.enc.join() };
}, { pub: k.pub, ORDER });
check("DV-34 a 5-character and a 300-character password give the same ciphertext size", sizes.a === sizes.b, `${sizes.a} bytes`);
check("each sealing uses a fresh encapsulated key", sizes.fresh);
check("FR-GAM-08 browser fingerprint of the test vector equals the SQL one", sizes.vec === "0ed3-a6ab-957f-f6f5-9a96", sizes.vec);

await browser.close(); server.close();
const version = (await import("playwright/package.json", { with: { type: "json" } })).default.version;
console.log(`\n${results.filter(Boolean).length} of ${results.length} browser checks passed (Chromium via Playwright ${version}, @hpke/core 1.9.0)`);
process.exit(results.every(Boolean) ? 0 : 1);
