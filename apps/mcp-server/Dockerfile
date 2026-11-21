FROM node:22.22-alpine

RUN corepack enable && corepack prepare pnpm@11.21 --activate

WORKDIR /app

# ── Layer-cache: workspace manifests only ────────────────────────────────────
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/mcp-server/package.json ./apps/mcp-server/

RUN pnpm install --frozen-lockfile --filter mcp-server

# ── Source ────────────────────────────────────────────────────────────────────
COPY apps/mcp-server/ ./apps/mcp-server/

EXPOSE 4002

# tsx keeps parity with the dev script (no tsc build step needed at runtime)
CMD ["pnpm", "--filter", "mcp-server", "exec", "tsx", "src/server.ts"]
