FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@11.21 --activate

WORKDIR /app

# ── Layer-cache: workspace manifests only ────────────────────────────────────
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/canvas-agent-runner/package.json ./apps/canvas-agent-runner/

RUN pnpm install --frozen-lockfile --filter canvas-agent-runner

# ── Source ────────────────────────────────────────────────────────────────────
COPY apps/canvas-agent-runner/ ./apps/canvas-agent-runner/

EXPOSE 4010

# tsx keeps parity with the dev script. The package tsconfig is noEmit — there
# is no tsc build step to run, same runtime pattern as mcp-server (tsx via the
# workspace filter, not a compiled dist).
CMD ["pnpm", "--filter", "canvas-agent-runner", "exec", "tsx", "src/index.ts"]
