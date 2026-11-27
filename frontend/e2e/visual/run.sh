#!/bin/sh
# Runs the screenshot tests in the pinned Playwright container (the same version as @playwright/test), as CI does (U11-02).
#   sh e2e/visual/run.sh                    compare with the baselines
#   sh e2e/visual/run.sh --update-snapshots make the baselines (only when a screen is meant to change)
# Needs Docker and a production build (npm run build) in frontend/. The repository is mounted; the container serves the build itself (e2e/serve.mjs).
set -e
cd "$(dirname "$0")/../.."
VERSION=$(node -p "require('@playwright/test/package.json').version")
docker run --rm --ipc=host -v "$(cd .. && pwd)":/work -w /work/frontend "mcr.microsoft.com/playwright:v${VERSION}-noble" npx playwright test -c e2e/visual/visual.config.ts "$@"
