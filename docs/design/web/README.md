# Unit 8 reference code: web client

Tested modules that the web client (`frontend/`) imports unchanged, and the reference configuration of the web
container. Design: `docs/design/08_frontend.pdf`.

| Path | What it is |
|---|---|
| `src/api.js` | API client: CSRF header, one refresh across tabs (Web Locks plus a probe), step-up, idempotency keys, problem documents |
| `src/money.js` | Poisha to text (lakh grouping, Bangla digits) and typed amounts to poisha, without floating point |
| `src/time.js` | Dhaka date and time, countdowns, deadlines, and `ServerClock` |
| `src/moneyState.js` | The order's money in plain language (NFR-USE-07) |
| `src/live.js` | Ordering of auction states and chat messages, resync after gaps |
| `src/i18n.js`, `src/messages/` | Message catalogues (English and Bangla, same keys) |
| `src/redirect.js` | Payment-provider redirects only to configured HTTPS hosts |
| `container/` | nginx configuration and the security headers of the four documents |
| `print/` | Generated ASCII copies for the PDF listings (`python3 make_print.py`) |

## Running the tests

```bash
cd docs/design/web
npm install
npm run test:unit        # 46 tests, Node 20 or later
npm run test:browser     # 12 checks in Chromium (Playwright)
npm run test:container   # 25 checks; needs nginx on PATH
sh test/run_all.sh       # all of them, as printed in the design document
```

Set `CHROMIUM_PATH` if Playwright should use a Chromium that is already installed.
