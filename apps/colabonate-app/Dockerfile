# ── Stage 1: build the Vite app ──────────────────────────────────────────────
FROM node:22.22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@11.21 --activate

WORKDIR /app

# Layer-cache: workspace manifests only
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.json ./

COPY packages/nostr-schema/package.json ./packages/nostr-schema/
COPY packages/payments/package.json     ./packages/payments/
COPY packages/tokens/package.json       ./packages/tokens/
COPY packages/ui/package.json           ./packages/ui/
COPY packages/utils/package.json        ./packages/utils/
COPY packages/data/package.json         ./packages/data/
COPY apps/colabonate-app/package.json   ./apps/colabonate-app/

RUN pnpm install --frozen-lockfile

# Source (packages must come before app so workspace deps resolve from source)
COPY packages/ ./packages/
COPY apps/colabonate-app/ ./apps/colabonate-app/

# Build design-system tokens (generates tokens.css + typography.css)
RUN node packages/tokens/scripts/build.js

# ADR-198: bake the frontend /admin gate pubkey into the SPA bundle. VITE_* vars
# are build-time only — without this the admin guard (AdminLayout/AdminPage) reads
# `undefined` and redirects every /admin/* route to "/". Vite auto-loads
# .env.production in `vite build`; the value is passed via compose build.args
# (VITE_ADMIN_PUBKEY = FOUNDATION_DAO_ADMIN_PUBKEY).
ARG VITE_ADMIN_PUBKEY
ARG VITE_COMMUNITY_CHANNEL_ID
ARG VITE_COMMUNITY_RELAYS
ARG VITE_CASHU_ENABLED
ARG VITE_PROJECT_LN_ADDRESS
# Product-Launch-Masterplan FU-662: Escrow Trade Desk (/trade/*) — no live
# IC-mainnet canister exists yet, so this must default off in any environment
# that doesn't explicitly pass it (same off-by-default contract as CASHU above).
ARG VITE_ESCROW_TRADE_DESK
# VITE_BETA_BADGE was removed 2026-09-23: the beta host was retired, the
# main-menu "Beta" badge is now always rendered, and the badge that used to be
# pinned to the login/onboarding/error logo was dropped (see branding/beta.ts).
# ADR-287: canonical origin for absolute SEO URLs (canonical/og:url/og:image).
# Production passes SITE_URL; unset falls back to the production origin
# (colabonate.app retired 2026-09-23 — see config/seo.ts).
ARG VITE_SITE_URL
RUN printf 'VITE_ADMIN_PUBKEY=%s\nVITE_COMMUNITY_CHANNEL_ID=%s\nVITE_COMMUNITY_RELAYS=%s\nVITE_CASHU_ENABLED=%s\nVITE_PROJECT_LN_ADDRESS=%s\nVITE_ESCROW_TRADE_DESK=%s\nVITE_SITE_URL=%s\n' \
      "${VITE_ADMIN_PUBKEY}" "${VITE_COMMUNITY_CHANNEL_ID}" "${VITE_COMMUNITY_RELAYS}" "${VITE_CASHU_ENABLED}" "${VITE_PROJECT_LN_ADDRESS}" "${VITE_ESCROW_TRADE_DESK}" "${VITE_SITE_URL}" > .env.production

# Build the SPA; VITE_API_URL defaults to '' (relative) — nginx proxy handles /api
RUN pnpm --filter colabonate-app build

# ── Stage 1b: prerender public routes (ADR — SEO/LLM snapshot prerendering) ──
# Bots without JavaScript (LLM crawlers, secondary search crawlers) receive
# fully rendered HTML per public route. The official Playwright image ships
# matching Chromium + deps; Alpine (stage 1) is unsupported by Playwright,
# hence a separate stage. The playwright npm package version must match the
# image tag so the preinstalled browsers are found.
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS prerenderer

# Canonical origin baked into sitemap.xml + prerendered snapshots
# (scripts/seo-routes.mjs SEO_BASE_URL, ADR-287). Defaults to
# https://colabonate.app if unset — a production build MUST pass this,
# otherwise its sitemap/canonical links point at the beta host.
ARG SITE_URL

WORKDIR /app/apps/colabonate-app
COPY --from=builder /app/apps/colabonate-app/dist ./dist
COPY apps/colabonate-app/scripts/ ./scripts/
RUN npm install playwright@1.59.1 --no-save --no-audit --no-fund \
 && SITE_URL="${SITE_URL}" node scripts/prerender.mjs

# ── Stage 2: serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY --from=prerenderer /app/apps/colabonate-app/dist /usr/share/nginx/html
COPY apps/colabonate-app/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
