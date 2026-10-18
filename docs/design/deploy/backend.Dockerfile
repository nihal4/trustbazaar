# syntax=docker/dockerfile:1.7
# TrustBazaar backend image (Unit 9). Build context: backend/. Used by the "backend" and "migrate" services.
# Two stages: dependencies and the TypeScript build, then a runtime image with production
# dependencies only, running as an unprivileged user (SEC-INF-01).

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S -g 10001 tb && adduser -S -D -H -u 10001 -G tb tb \
 && mkdir -p /srv/files/kyc /srv/files/listings /srv/files/proofs /srv/files/chat /srv/files/evidence /srv/files/exports \
 && chown -R tb:tb /srv/files && chmod -R 0700 /srv/files
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER 10001:10001
EXPOSE 3000
CMD ["node", "dist/main.js"]
