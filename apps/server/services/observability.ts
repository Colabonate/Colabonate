import pino from 'pino'
import pinoHttp, { type HttpLogger } from 'pino-http'
import type { Express, Request, Response } from 'express'

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info'

export const logger = pino({
  level: LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

export const httpLogger: HttpLogger<Request, Response> = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req: Request) => req.url === '/health',
  },
  customLogLevel: (_req: Request, res: Response, err: Error | undefined) => {
    if (res.statusCode >= 500 || err) return 'error'
    if (res.statusCode >= 400) return 'warn'
    return 'info'
  },
  customSuccessMessage: (req: Request, res: Response, _responseTime: number) => {
    return `${req.method} ${req.url} ${res.statusCode}`
  },
  customErrorMessage: (req: Request, res: Response, err: Error) => {
    return `${req.method} ${req.url} ${res.statusCode} — ${err.message}`
  },
  customAttributeKeys: {
    req: 'request',
    res: 'response',
    err: 'error',
    responseTime: 'duration_ms',
  },
  customProps: (req: Request) => ({
    traceId: getTraceId(req),
  }),
})

export function setupObservability(app: Express): void {
  app.use(httpLogger)
}

export function getTraceId(req: Request): string {
  const spanContext = getCurrentSpanContext()
  if (spanContext) {
    return `${spanContext.traceId}`
  }
  return (req.headers['x-trace-id'] as string) ?? generateTraceId()
}

function getCurrentSpanContext(): { traceId: string } | null {
  try {
    const { context } = require('@opentelemetry/api')
    if (context && typeof context.active === 'function') {
      const span = context.active()
      if (span) {
        const spanContext = (span as { spanContext?: () => { traceId: string } | null }).spanContext?.()
        if (spanContext) return { traceId: spanContext.traceId }
      }
    }
  } catch {
    // OTel not initialized
  }
  return null
}

function generateTraceId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

// In-memory metrics registry — replace with OpenTelemetry Meter when OTel is added
const metrics: Map<string, number> = new Map()
const metricHistograms: Map<string, number[]> = new Map()

export const metricsRegistry = {
  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = metricKey(name, labels)
    metrics.set(key, (metrics.get(key) ?? 0) + 1)
  },

  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = metricKey(name, labels)
    const buckets = metricHistograms.get(key) ?? []
    buckets.push(value)
    if (buckets.length > 1000) buckets.shift()
    metricHistograms.set(key, buckets)
  },

  getCounter(name: string, labels?: Record<string, string>): number {
    return metrics.get(metricKey(name, labels)) ?? 0
  },

  getHistogramPercentiles(name: string, labels?: Record<string, string>, pcts = [50, 95, 99]): Record<number, number> {
    const buckets = metricHistograms.get(metricKey(name, labels)) ?? []
    if (!buckets.length) return Object.fromEntries(pcts.map(p => [p, 0]))
    const sorted = [...buckets].sort((a, b) => a - b)
    return Object.fromEntries(
      pcts.map(pct => {
        const idx = Math.ceil((pct / 100) * sorted.length) - 1
        return [pct, sorted[Math.max(0, idx)]]
      }),
    )
  },

  getGauge(name: string, labels?: Record<string, string>): number {
    return metrics.get(metricKey(name, labels)) ?? 0
  },
}

/**
 * Snapshot the in-memory registry for export.
 * Returns a plain object — counters, gauges, and per-name histogram samples
 * (with the same 1000-sample cap the live registry uses) — so the metrics
 * route can render it in Prometheus text format without holding the registry
 * across the HTTP write.
 */
export interface MetricsSnapshot {
  counters: Record<string, number>
  histograms: Record<string, { labels: Record<string, string>; samples: number[] }[]>
  collectedAt: string
}

export function snapshotMetrics(): MetricsSnapshot {
  const counters: Record<string, number> = {}
  for (const [k, v] of metrics) counters[k] = v

  const histograms: Record<string, { labels: Record<string, string>; samples: number[] }[]> = {}
  for (const [k, samples] of metricHistograms) {
    const space = k.indexOf(' ')
    const name = space === -1 ? k : k.slice(0, space)
    const labelStr = space === -1 ? '' : k.slice(space + 1)
    const labels: Record<string, string> = {}
    if (labelStr) {
      for (const part of labelStr.split(' ')) {
        const eq = part.indexOf('=')
        if (eq > 0) labels[part.slice(0, eq)] = part.slice(eq + 1)
      }
    }
    histograms[name] = histograms[name] ?? []
    histograms[name].push({ labels, samples: [...samples] })
  }

  return { counters, histograms, collectedAt: new Date().toISOString() }
}

/**
 * Render a MetricsSnapshot as Prometheus text format (v0.0.4).
 * - Counters:  colabonate_<name>_total{labels} <value>
 * - Histograms: colabonate_<name>_bucket{le="..."}  + _count + _sum (cumulative,
 *   reconstructed from the in-memory ring buffer — 1ms/10ms/100ms/1s/10s buckets).
 */
export function metricsToPrometheusText(snap: MetricsSnapshot): string {
  const lines: string[] = []
  const HELP = '# HELP colabonate_metric In-process application metric (counter, gauge, or histogram)'
  const TYPE_COUNTER = '# TYPE colabonate_metric counter'
  const TYPE_HIST = '# TYPE colabonate_metric histogram'

  // Counters / gauges
  lines.push(HELP, TYPE_COUNTER)
  for (const [key, value] of Object.entries(snap.counters)) {
    const { name, labelStr } = splitMetricKey(key)
    lines.push(`colabonate_${name}_total${labelStr} ${value}`)
  }

  // Histograms
  if (Object.keys(snap.histograms).length > 0) {
    lines.push(TYPE_HIST)
    const bucketEdges = [0.001, 0.01, 0.1, 1, 10, Number.POSITIVE_INFINITY]
    for (const [name, series] of Object.entries(snap.histograms)) {
      for (const { labels, samples } of series) {
        const sorted = [...samples].sort((a, b) => a - b)
        const count = sorted.length
        const sum = sorted.reduce((a, b) => a + b, 0)
        for (const edge of bucketEdges) {
          const le = edge === Number.POSITIVE_INFINITY ? '+Inf' : String(edge)
          const below = sorted.filter(s => s <= edge).length
          const labelParts = [`le="${le}"`]
          for (const [k, v] of Object.entries(labels)) labelParts.push(`${k}="${v}"`)
          lines.push(`colabonate_${name}_bucket{${labelParts.join(',')}} ${below}`)
        }
        const countParts = []
        for (const [k, v] of Object.entries(labels)) countParts.push(`${k}="${v}"`)
        lines.push(`colabonate_${name}_count{${countParts.join(',')}} ${count}`)
        lines.push(`colabonate_${name}_sum{${countParts.join(',')}} ${sum}`)
      }
    }
  }

  return lines.join('\n') + '\n'
}

function splitMetricKey(key: string): { name: string; labelStr: string } {
  const space = key.indexOf(' ')
  if (space === -1) return { name: key, labelStr: '' }
  return { name: key.slice(0, space), labelStr: '{' + key.slice(space + 1).split(' ').map(p => {
    const eq = p.indexOf('=')
    return eq === -1 ? p : `${p.slice(0, eq)}="${p.slice(eq + 1)}"`
  }).join(',') + '}' }
}

function metricKey(name: string, labels?: Record<string, string>): string {
  if (!labels) return name
  return `${name} ${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(' ')}`
}

export function resetMetrics(): void {
  metrics.clear()
  metricHistograms.clear()
}

export async function initOpenTelemetry(): Promise<void> {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    try {
      const { NodeSDK } = await import('@opentelemetry/sdk-node')
      const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node')
      const sdk = new NodeSDK({
        serviceName: 'colabonate-server',
        traceExporter: undefined,
        instrumentations: [getNodeAutoInstrumentations()],
      })
      sdk.start()
      logger.info('OpenTelemetry initialized')
    } catch (err) {
      logger.warn({ err }, 'OpenTelemetry initialization failed — continuing without OTel')
    }
  }
}