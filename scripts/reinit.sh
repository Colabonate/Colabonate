#!/usr/bin/env bash
# reinit.sh – Full project reset after git pull on a new/broken environment.
# Wipes PostgreSQL dev DB, rebuilds schema, reseeds, starts dependent services.
# Usage: bash scripts/reinit.sh
# Safe to run repeatedly.

set -e

# ── Windows/Docker Desktop compatibility ────────────────────────────────────
# Three possible environments on Windows:
#   1. WSL 2          → use docker.exe (Windows interop, no integration needed)
#   2. Git Bash/MINGW → override /usr/bin/docker stub with Docker Desktop CLI
#   3. Linux          → use docker from PATH as-is
_DOCKER_DESKTOP="/c/Program Files/Docker/Docker/resources/bin/docker"

if grep -qi "microsoft" /proc/version 2>/dev/null; then
  # Running inside WSL 2 – use Docker Desktop via Windows interop
  if ! command -v docker &>/dev/null || ! docker compose version &>/dev/null 2>&1; then
    if command -v docker.exe &>/dev/null; then
      docker() { docker.exe "$@"; }
    else
      echo -e "\033[0;31m✗ docker.exe not found. Make sure Docker Desktop is running.\033[0m"
      exit 1
    fi
  fi
elif [[ -f "$_DOCKER_DESKTOP" ]]; then
  # Git Bash: /usr/bin/docker is a stub – use Docker Desktop's real CLI
  docker() { "$_DOCKER_DESKTOP" "$@"; }
  [[ "${DOCKER_HOST:-}" == unix://* ]] && unset DOCKER_HOST
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step() { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; }

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════╗"
echo "║   Colabonate – Re-Init & Wipe Script     ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Pre-flight: check .env ──────────────────────────────────────────────────
if [[ ! -f ".env" ]]; then
  fail ".env file not found – copy .env_example to .env and fill in the values."
  exit 1
fi

ADMIN_PUBKEY=$(grep -E '^FOUNDATION_DAO_ADMIN_PUBKEY=' .env | cut -d= -f2 | tr -d '[:space:]')
if [[ -z "$ADMIN_PUBKEY" ]]; then
  warn "FOUNDATION_DAO_ADMIN_PUBKEY is not set in .env"
  warn "Foundation DAO seed will be skipped – admin menu will not appear."
  warn "Set it to your hex pubkey (convert npub via: npx ts-node -e \"const {nip19}=require('nostr-tools'); console.log(nip19.decode('npub1...').data)\")"
  echo ""
fi

warn "This will DELETE the local PostgreSQL dev DB (port 5434) and reseed all test data."
warn "Docker services (postgres, redis, meilisearch) will be restarted."
read -r -p "Continue? (y/N) " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ── 1. Install dependencies ──────────────────────────────────────────────────
step "Installing dependencies (pnpm install)"
npx pnpm install
ok "Dependencies installed"

# ── 2. Build design tokens ───────────────────────────────────────────────────
step "Building design tokens"
npx pnpm tokens:build
ok "Tokens built"

# ── 3. Check if port 6379 is already in use ─────────────────────────────────
step "Checking port 6379 availability"
port_in_use() {
  # Works on Linux (ss), macOS (lsof), and Windows (netstat via Git Bash)
  ss -tlnp 2>/dev/null | grep -q ':6379' ||
  netstat -an 2>/dev/null | grep -qE '(LISTENING|ESTABLISHED).*:6379|:6379.*(LISTENING|ESTABLISHED)' ||
  lsof -i :6379 -sTCP:LISTEN &>/dev/null 2>&1
}
if port_in_use; then
  warn "Port 6379 is in use"
  if docker compose -f docker-compose.dev.yml ps redis 2>/dev/null | grep -qiE 'running|up'; then
    warn "Docker Compose Redis already running – skipping redis restart"
    SKIP_REDIS=1
  elif pgrep -x redis-server &>/dev/null; then
    warn "Local redis-server in use – skipping Docker redis"
    SKIP_REDIS=1
  elif command -v systemctl &>/dev/null && systemctl is-active --quiet redis 2>/dev/null; then
    warn "System Redis in use – skipping Docker redis"
    SKIP_REDIS=1
  fi
fi

step "Starting Docker services (postgres:5434, redis:6379, meilisearch:7700)"
if [[ "${SKIP_REDIS:-0}" == "1" ]]; then
  docker compose -f docker-compose.dev.yml up -d postgres meilisearch
  warn "Docker postgres and meilisearch started (redis skipped)"
else
  docker compose -f docker-compose.dev.yml up -d --force-recreate
fi
ok "Docker services started"

# Wait for postgres to be healthy
step "Waiting for postgres to be ready..."
for i in $(seq 1 30); do
  if docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U colabonate -d colabonate &>/dev/null; then
    ok "PostgreSQL is ready"
    break
  fi
  if [[ $i -eq 30 ]]; then
    fail "PostgreSQL did not become ready in time"
    exit 1
  fi
  sleep 1
done

# ── 5. Drop and recreate DB (wipe + apply all PG migrations) ────────────────
step "Wiping PostgreSQL DB and applying all migrations"
docker compose -f docker-compose.dev.yml exec -T postgres psql -U colabonate -d postgres -c "DROP DATABASE IF EXISTS colabonate;" 2>/dev/null || true
docker compose -f docker-compose.dev.yml exec -T postgres psql -U colabonate -d postgres -c "CREATE DATABASE colabonate;" 2>/dev/null || true

PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="reinit-script" \
  DATABASE_URL="postgresql://colabonate:dev@127.0.0.1:5434/colabonate" \
  DIRECT_URL="postgresql://colabonate:dev@127.0.0.1:5434/colabonate" \
  npx pnpm prisma migrate deploy
ok "All migrations applied (ADR-139 PG init + pg_trgm)"

# ── 6. Regenerate Prisma Client ─────────────────────────────────────────────
step "Generating Prisma Client"
npx pnpm prisma generate
ok "Prisma Client generated"

# ── 7. Seed test data ─────────────────────────────────────────────────────────
step "Seeding test data"
DATABASE_URL="postgresql://colabonate:dev@127.0.0.1:5434/colabonate" \
  DIRECT_URL="postgresql://colabonate:dev@127.0.0.1:5434/colabonate" \
  npx pnpm prisma:seed
ok "Database seeded"

# ── 8. Build/seed Meilisearch index ─────────────────────────────────────────
step "Bootstrapping Meilisearch index (offers_v1)"
MEILISEARCH_URL=http://localhost:7700 MEILISEARCH_MASTER_KEY=dev-master-key \
  npx tsx scripts/bootstrap-meili.ts || warn "Meili bootstrap failed – search falls back to DB"
ok "Meilisearch index bootstrapped"

# ── 9. Start OutboxWorker (needs SEARCH_BACKEND=meilisearch) ─────────────────
step "Starting server with OutboxWorker (SEARCH_BACKEND=meilisearch)"
SEARCH_BACKEND=meilisearch \
  CACHE_ENABLED=true \
  DATABASE_URL="postgresql://colabonate:dev@127.0.0.1:5434/colabonate" \
  DIRECT_URL="postgresql://colabonate:dev@127.0.0.1:5434/colabonate" \
  REDIS_URL=redis://localhost:6379 \
  MEILISEARCH_URL=http://localhost:7700 \
  MEILISEARCH_MASTER_KEY=dev-master-key \
  APP_PORT=4001 \
  npx pnpm dev &
SERVER_PID=$!

sleep 5

step "Verifying health endpoints"
HEALTH_OK=false
if curl -sf http://localhost:4001/health &>/dev/null; then
  ok "Server /health OK"
  HEALTH_OK=true
else
  warn "Server /health not responding yet"
fi

# Per-service health checks (ADR-139 Phase 6)
for endpoint in db redis meili; do
  if curl -sf "http://localhost:4001/health/${endpoint}" &>/dev/null; then
    ok "/health/${endpoint} OK"
  else
    warn "/health/${endpoint} unavailable (service may not be ready)"
  fi
done

if [[ "$HEALTH_OK" == "false" ]]; then
  warn "Server may still be starting — check manually: curl http://localhost:4001/health"
fi

# ── 10. Verify Foundation DAO ───────────────────────────────────────────────
if [[ -n "$ADMIN_PUBKEY" ]]; then
  step "Verifying Foundation DAO admins"
  sleep 2
  ADMIN_COUNT=$(curl -sf http://localhost:4001/api/dao/foundation/admins 2>/dev/null | grep -o '"[^"]\{20,\}"' | wc -l || echo "0")
  if [[ "$ADMIN_COUNT" -gt 0 ]]; then
    ok "Foundation DAO admins verified ($ADMIN_COUNT found)"
  else
    warn "Foundation DAO returned 0 admins – check FOUNDATION_DAO_ADMIN_PUBKEY"
  fi
else
  warn "Foundation DAO admin not seeded – set FOUNDATION_DAO_ADMIN_PUBKEY in .env"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}╔══════════════════════════════════════════╗"
echo "║   ✓ Re-Init complete!                         ║"
echo "║   Server: http://localhost:4001               ║"
echo "║   PostgreSQL: localhost:5434                  ║"
echo "║   Redis: localhost:6379                       ║"
echo "║   Meilisearch: localhost:7700 (SEARCH_BACKEND=meilisearch) ║"
echo "║   Cache: enabled (CACHE_ENABLED=true)        ║"
echo "╚══════════════════════════════════════════╝${NC}\n"
echo "Stop services: docker compose -f docker-compose.dev.yml down"
echo "Restart server: npx pnpm dev"