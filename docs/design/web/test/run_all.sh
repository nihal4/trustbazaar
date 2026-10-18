#!/bin/sh
# Runs every Unit 8 reference test and prints a plain-ASCII report (used for the design document).
# Needs Node 20+, npm install, Chromium for Playwright, and nginx on PATH for the container test.
cd "$(dirname "$0")/.." || exit 1
npm run -s build >/dev/null 2>&1 || exit 1
echo "Unit tests (node --test)"
node --test --test-reporter=spec test/*.test.js 2>&1 | sed -n 's/^\(✔\|✖\) \(.*\) ([0-9.]*ms)$/\1 \2/p' \
  | sed 's/^✔ /PASS  /; s/^✖ /FAIL  /'
node --test test/*.test.js 2>&1 | sed -n 's/^# \(tests\|pass\|fail\) \([0-9]*\)$/\1 \2/p' | tr '\n' ' '
echo "(Node $(node --version))"
echo
echo "Browser tests (Chromium): cookies, CSRF, refresh across tabs, Intl"
node test/browser_test.mjs
echo
echo "Web container tests (nginx and Chromium): documents, headers, policies, proxy"
node test/container_test.mjs
