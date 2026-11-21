#!/usr/bin/env node
/**
 * ADR-370 Phase 4 (FU-673): canvas-agent-runner entry point.
 *
 * A separate process (Owner decision 6) acting as the seller-configured agent
 * on doop-hosted ticket canvases. Control API (internal, token-guarded) is
 * served on CANVAS_RUNNER_PORT (default 4010); the server's outbox worker
 * calls /control/start|/control/stop, and /control/key/:ticketId exposes the
 * per-ticket pubkey the seller seals the persona to.
 *
 * Run:  pnpm --filter canvas-agent-runner dev    (tsx watch)
 * Env:  CANVAS_RUNNER_PORT, CANVAS_RUNNER_MASTER_SECRET,
 *       DOOP_SERVICE_URL, DOOP_SERVICE_TOKEN
 */
import { startControlServer } from './control.js'

startControlServer()
