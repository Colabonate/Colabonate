// ADR-281 D9 — allowlisted CLI-Adapter registry. v1 ships the three known
// agent CLIs; custom adapter definitions are deferred (FU-292). Each entry
// declares only the parts of the run template that are fixed; the launcher
// (bunx / npx / direct) is prepended at run time by runner.ts (D10).

// FU-291 infrastructure — a raw stdout line, classified as either the start
// of a tool call or its result. `resultText` is handed to the existing
// `parseToolResult()` in ai-chat.ts, same as the Ollama/OpenAI tool path.
export interface AdapterToolEvent {
  kind: 'tool-start' | 'tool-result';
  tool?: string;
  label?: string;
  resultText?: string;
}

export interface AdapterDef {
  id: string;
  label: string;
  description: string;
  // FU-292 (scoped) — `extraArgs` are user-supplied flags for THIS adapter's
  // own fixed binary, validated server-side (apps/server/routes/ai-config.ts:
  // array of plain strings, length- and control-character-checked) and
  // inserted between the fixed subcommand/flag and the prompt. No new binary
  // names are ever introduced — this only extends the already-allowlisted
  // opencode/pi/hermes invocations; the prompt stays the final argv element
  // (D10 invariant unchanged).
  runArgs: (prompt: string, extraArgs?: string[]) => string[];
  // FU-291 — optional per-adapter parser mapping one raw stdout line to a
  // structured tool-activity event, so adapter turns can populate the same
  // tool-start/tool-result SSE events (and entity cards) as the Ollama/OpenAI
  // path. Left undefined for all three adapters below: no adapter here has a
  // verified structured-output format yet (opencode reportedly exports
  // structured logs, pi/hermes formats are unknown) — writing a parser
  // against a guessed format would silently misparse real output. When one
  // is undefined, the adapter's stdout streams as plain text-delta, unchanged
  // from v1 behavior.
  parseToolActivity?: (line: string) => AdapterToolEvent | null;
}

export const ADAPTERS: AdapterDef[] = [
  {
    id: 'opencode',
    label: 'OpenCode',
    description: 'OpenCode CLI coding agent (opencode.ai)',
    // Verified 2026-08-17: `opencode run <message>` is a real subcommand.
    runArgs: (prompt, extraArgs = []) => ['run', ...extraArgs, prompt],
  },
  {
    id: 'pi',
    label: 'Pi Agent',
    description: 'Pi Agent CLI coding assistant (pi.ai)',
    // Verified 2026-08-17: binary is `pi` (v0.84.1 on the dev machine);
    // non-interactive mode is `--print` (process prompt and exit).
    runArgs: (prompt, extraArgs = []) => ['--print', ...extraArgs, prompt],
  },
  {
    id: 'hermes',
    label: 'Hermes',
    description: 'Hermes agent CLI',
    // Verified 2026-08-17: hermes takes a zero-shot prompt via `-z`, not `run`.
    runArgs: (prompt, extraArgs = []) => ['-z', ...extraArgs, prompt],
  },
];

export function findAdapter(id: string): AdapterDef | undefined {
  return ADAPTERS.find((a) => a.id === id);
}