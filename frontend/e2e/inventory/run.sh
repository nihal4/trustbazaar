#!/bin/sh
# Runs the inventory harvest in the pinned Playwright container (U11-13). Needs Docker and a production build (npm run build). Writes docs/design/11_inventory/.
set -e
cd "$(dirname "$0")/../.."
VERSION=$(node -p "require('@playwright/test/package.json').version")
docker run --rm --ipc=host -v "$(cd .. && pwd)":/work -w /work/frontend "mcr.microsoft.com/playwright:v${VERSION}-noble" npx playwright test -c e2e/inventory/inventory.config.ts "$@"
