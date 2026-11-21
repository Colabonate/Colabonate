// ADR-281 D5/D11 — GET /ai/config capability endpoint: which provider modes
// this deployment offers, plus a live availability probe of the CLI adapters
// (cached 30 s). Consumed by the Settings AI tab to render the provider cards.
import type { ServerResponse } from 'http';
import { ADAPTERS } from './registry.js';
import { probeAdapter, resolveRuntime } from './runner.js';
import { ADAPTER_ENABLED, PLATFORM_LLM_CONFIGURED } from '../config.js';

export async function handleAiCapabilities(res: ServerResponse): Promise<void> {
  try {
    const runtime = resolveRuntime('auto');
    const adapters = ADAPTERS.map((a) => {
      const probe = probeAdapter(a.id, runtime);
      return {
        id: a.id,
        label: a.label,
        description: a.description,
        available: probe.available,
        version: probe.version ?? null,
        hint: probe.hint,
        resolvedPath: probe.resolvedPath ?? null,
      };
    });

    const body = JSON.stringify({
      modes: [
        { id: 'local', enabled: true, label: 'Local (Ollama)', supportsImages: true },
        { id: 'openai', enabled: true, label: 'OpenAI-compatible provider', supportsImages: true },
        // ADR-384: enabled only once the operator configured a real paid LLM (FU-773).
        { id: 'platform', enabled: PLATFORM_LLM_CONFIGURED, label: 'Colabonate Hosted', supportsImages: true },
        { id: 'adapter', enabled: ADAPTER_ENABLED, label: 'CLI agent (OpenCode / Pi Agent / Hermes)', supportsImages: false },
      ],
      adapters,
      runtime,
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'max-age=30');
    res.end(body);
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err) }));
  }
}