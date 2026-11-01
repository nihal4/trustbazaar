# syntax=docker/dockerfile:1.7
# TrustBazaar web image (Units 8 and 9). Build context: frontend/. Extra build contexts from Compose:
# "webconf" = docs/design/web/container (Unit 8's tested nginx configuration), "deploy" = docs/design/deploy.
# Two stages: the Vite production build, then nginx running unprivileged on port 8080 (SEC-INF-01).

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_PAYMENT_HOSTS=""
ENV VITE_PAYMENT_HOSTS=$VITE_PAYMENT_HOSTS
# The terms and privacy versions registration sends; Compose passes the backend's TERMS_VERSION and PRIVACY_VERSION.
ARG VITE_TERMS_VERSION="2026-11-01"
ARG VITE_PRIVACY_VERSION="2026-11-01"
ENV VITE_TERMS_VERSION=$VITE_TERMS_VERSION VITE_PRIVACY_VERSION=$VITE_PRIVACY_VERSION
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
USER root
RUN apk upgrade --no-cache   # Alpine security fixes for the image scan (SEC-SDL-07)
COPY --from=webconf nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=webconf tb/ /etc/nginx/tb/
RUN sed -i 's/BACKEND/backend:3000/g' /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY --from=deploy security.txt /usr/share/nginx/html/.well-known/security.txt
USER 101
EXPOSE 8080
