import { Router } from 'express'
import { snapshotMetrics, metricsToPrometheusText } from '../services/observability.js'

// ADR-227 D2 — exposes the in-process `metricsRegistry` (`apps/server/services/observability.ts:78`)
// as a Prometheus text-format scrape target for VictoriaMetrics. No new runtime
// dependency: the route renders the existing in-memory map directly. Gated by
// METRICS_ENABLED (default false on non-prod stacks so local dev is unaffected;
// true in docker-compose.beta.yml). Internal-only — the proxy never routes
// /metrics externally; VictoriaMetrics scrapes via the Docker DNS alias `server`.
export function createMetricsRouter(): Router {
  const router = Router()

  const enabled = process.env.METRICS_ENABLED === 'true'

  router.get('/metrics', (_req, res) => {
    if (!enabled) {
      res.status(404).json({ error: 'METRICS_DISABLED' })
      return
    }
    const body = metricsToPrometheusText(snapshotMetrics())
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    res.status(200).send(body)
  })

  return router
}
