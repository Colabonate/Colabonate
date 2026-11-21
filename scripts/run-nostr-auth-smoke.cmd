@echo off
set DATABASE_URL=postgresql://colabonate:dev@127.0.0.1:5434/colabonate
set API_URL=http://localhost:4001
npx pnpm exec tsx apps/server/scripts/nostr-auth-live-smoke-test.ts
