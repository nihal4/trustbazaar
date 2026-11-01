# syntax=docker/dockerfile:1.7
# TrustBazaar backend image (Unit 9). Build context: backend/. Used by the "backend" and "migrate" services.
# Two stages: dependencies and the TypeScript build, then a runtime image with production
# dependencies only, running as an unprivileged user (SEC-INF-01).

FROM node:20-alpine AS build
WORKDIR /app
# argon2's bundled musl prebuild crashes (segfault) on current Alpine, so argon2 alone is compiled here
# from source (sharp keeps its own prebuilt libvips for musl). The compilers stay in this stage; the
# runtime image below has none.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci && npm rebuild argon2 --build-from-source
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Alpine security fixes, and no npm, npx, yarn or corepack: the image runs only `node`, and npm's own
# bundled packages (tar, glob, sigstore...) were the image scan's findings (SEC-SDL-07).
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
RUN addgroup -S -g 10001 tb && adduser -S -D -H -u 10001 -G tb tb \
 && mkdir -p /srv/files/kyc /srv/files/listings /srv/files/proofs /srv/files/chat /srv/files/evidence /srv/files/exports \
 && chown -R tb:tb /srv/files && chmod -R 0700 /srv/files
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER 10001:10001
EXPOSE 3000
CMD ["node", "dist/main.js"]
