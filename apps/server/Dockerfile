FROM node:22.22-alpine

RUN corepack enable && corepack prepare pnpm@11.21 --activate

WORKDIR /app

# ── Layer-cache: workspace manifests only ────────────────────────────────────
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

COPY packages/nostr-schema/package.json ./packages/nostr-schema/
COPY packages/payments/package.json     ./packages/payments/
COPY packages/tokens/package.json       ./packages/tokens/
COPY packages/ui/package.json           ./packages/ui/
COPY packages/utils/package.json        ./packages/utils/
COPY packages/data/package.json         ./packages/data/
COPY apps/server/package.json           ./apps/server/

RUN pnpm install --frozen-lockfile

# ── Source ────────────────────────────────────────────────────────────────────
COPY prisma/              ./prisma/
COPY packages/            ./packages/
COPY apps/server/         ./apps/server/
COPY docs/protocols/governance/dao-codex.md ./docs/protocols/governance/dao-codex.md

# ── Prisma client generation (uses apps/server/prisma.config.ts) ──────────────
RUN pnpm --filter server exec prisma generate

EXPOSE 4001

# Run migrations then start the server via tsx (avoids tsc rootDir mismatch)
CMD ["sh", "-c", "pnpm --filter server exec prisma migrate deploy && pnpm --filter server exec tsx index.ts"]
