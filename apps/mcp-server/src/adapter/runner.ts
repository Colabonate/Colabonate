// ADR-281 D10 — adapter execution contract: `spawn` with an arg array and
// `shell: false` (no shell interpolation of prompts), stdout streamed as
// `text-delta`, stderr buffered (8 KB tail) for error reporting, 120 s hard
// timeout (SIGTERM → SIGKILL after 2 s), abort honoured via AbortSignal.
// Runtime resolution: explicit bun/npx/direct, or auto → bun → npx → direct.
import { spawn, spawnSync } from 'child_process';
import { accessSync, constants as fsConstants } from 'fs';
import { join, delimiter } from 'path';
import { homedir, platform } from 'os';

export type AdapterRuntime = 'auto' | 'bun' | 'npx' | 'direct';

export interface AdapterProbe {
  available: boolean;
  version?: string;
  hint: string;
  resolvedPath?: string;
}

const LAUNCHER_ORDER: AdapterRuntime[] = ['bun', 'npx', 'direct'];

function launcher(runtime: AdapterRuntime, cmd: string): { cmd: string; args: string[] } {
  if (runtime === 'bun') return { cmd: 'bunx', args: [cmd] };
  if (runtime === 'npx') return { cmd: 'npx', args: ['--yes', cmd] };
  return { cmd, args: [] };
}

// FU-294 — cross-platform install-location resolution. Node's bare
// `spawnSync(cmd, ...)` PATH lookup is inconsistent on Windows for
// extension-less commands; this walks PATH (plus a few well-known
// per-platform install dirs the CLIs commonly land in, e.g. bun/npm global
// bin) ourselves, applying PATHEXT on Windows, without ever invoking a shell
// (keeps the D10 `shell: false` invariant — this is a lookup, not an exec).
function candidateNames(cmd: string): string[] {
  if (platform() !== 'win32') return [cmd];
  const exts = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
  return [cmd, ...exts.map((ext) => `${cmd}${ext.toLowerCase()}`)];
}

function extraSearchDirs(): string[] {
  if (platform() === 'win32') {
    const dirs: string[] = [];
    if (process.env.LOCALAPPDATA) dirs.push(join(process.env.LOCALAPPDATA, 'Programs'), join(process.env.LOCALAPPDATA, 'bin'));
    if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'npm'));
    return dirs;
  }
  return [join(homedir(), '.bun', 'bin'), join(homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin'];
}

export function resolveExecutable(cmd: string): { found: boolean; path?: string } {
  const dirs = [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...extraSearchDirs()];
  const names = candidateNames(cmd);
  for (const dir of dirs) {
    for (const name of names) {
      const full = join(dir, name);
      try {
        accessSync(full, fsConstants.X_OK);
        return { found: true, path: full };
      } catch {
        // not here, keep searching
      }
    }
  }
  return { found: false };
}

function hasCommand(cmd: string): boolean {
  const resolved = resolveExecutable(cmd);
  if (!resolved.found) return false;
  const res = spawnSync(resolved.path!, ['--version'], { shell: false, stdio: 'ignore', timeout: 2500 });
  return !res.error && typeof res.status === 'number' && res.status === 0;
}

export function resolveRuntime(runtime: AdapterRuntime | null): AdapterRuntime {
  if (runtime && runtime !== 'auto') return runtime;
  for (const candidate of LAUNCHER_ORDER) {
    if (candidate === 'direct') return 'direct';
    if (hasCommand(candidate)) return candidate;
  }
  return 'direct';
}

const PROBE_TIMEOUT_MS = 3000;
const PROBE_TTL_MS = 30_000;
const probeCache = new Map<string, { at: number; probe: AdapterProbe }>();

// Probing never downloads anything: it checks the direct binary on PATH and
// the bun/npx launchers themselves (bunx/npx would auto-install the package on
// a run, which is intended for actual runs but not for availability probes).
export function probeAdapter(cmd: string, runtime: AdapterRuntime): AdapterProbe {
  const key = `${cmd}:${runtime}`;
  const cached = probeCache.get(key);
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.probe;

  const probe = doProbe(cmd, runtime);
  probeCache.set(key, { at: Date.now(), probe });
  return probe;
}

function doProbe(cmd: string, runtime: AdapterRuntime): AdapterProbe {
  // For bun/npx only probe the launcher binary itself — never trigger a
  // package download just to answer "is it available?".
  if (runtime !== 'direct') {
    const ok = hasCommand(runtime);
    return {
      available: ok,
      ...(ok ? { hint: `via ${runtime === 'bun' ? 'bunx' : 'npx'} (launcher present)` } : { hint: `${runtime} launcher not found` }),
    };
  }
  const resolved = resolveExecutable(cmd);
  if (!resolved.found) {
    return { available: false, hint: `${cmd} not found on PATH or common install dirs (install it or use bun/npx)` };
  }
  const res = spawnSync(resolved.path!, ['--version'], {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: PROBE_TIMEOUT_MS,
  });
  if (res.error || typeof res.status !== 'number' || res.status !== 0) {
    return { available: false, hint: `${cmd} found at ${resolved.path} but --version failed`, resolvedPath: resolved.path };
  }
  const firstLine = (res.stdout?.toString() ?? res.stderr?.toString() ?? '').split('\n')[0].trim();
  return { available: true, version: firstLine || undefined, hint: `direct — ${resolved.path}`, resolvedPath: resolved.path };
}

export interface AdapterRunResult {
  exitCode: number | null;
  timedOut: boolean;
  stderrTail: string;
}

export function spawnAdapter(
  cmd: string,
  runtime: AdapterRuntime,
  runArgs: string[],
  signal: AbortSignal,
  onStdout: (chunk: string) => void,
  timeoutMs = 120_000
): Promise<AdapterRunResult> {
  return new Promise((resolve) => {
    const launch = launcher(runtime, cmd);
    // FU-294 — for direct runtime, run the same resolved absolute path the
    // availability probe found, instead of relying on the OS's own PATH
    // lookup at spawn time (the exact gap this follow-up closes). Falls back
    // to the bare command name if resolution fails, so an uninstalled tool
    // still produces the pre-existing ENOENT error path unchanged.
    const launchCmd = runtime === 'direct' ? (resolveExecutable(launch.cmd).path ?? launch.cmd) : launch.cmd;
    const child = spawn(launchCmd, [...launch.args, ...runArgs], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Plain-text output: agent CLIs colorize ANSI by default, which would
      // garble the SSE stream.
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    let timedOut = false;
    let stderrBuf = '';
    const stopTimer = () => clearTimeout(timer);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2000);
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => onStdout(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderrBuf = `${stderrBuf}${chunk}`.slice(-8000);
    });

    child.on('error', (err) => {
      stopTimer();
      resolve({ exitCode: null, timedOut, stderrTail: `Failed to spawn ${cmd}: ${err.message}` });
    });
    child.on('close', (code) => {
      stopTimer();
      resolve({ exitCode: code, timedOut, stderrTail: stderrBuf });
    });

    signal.addEventListener('abort', () => {
      stopTimer();
      child.kill('SIGTERM');
    }, { once: true });
  });
}