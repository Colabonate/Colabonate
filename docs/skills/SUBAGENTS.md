# Sub-Agent Orchestration – SUBAGENTS Skill

> **Lesen bevor** ein komplexer Multi-Agent-Task gestartet wird.

---

## Installierte Agents

| Agent | Version | Besonderheit |
|-------|---------|--------------|
| **opencode** | v1.2.25 | `run` + `serve` + `acp` (Agent Client Protocol) |
| **kilocode** | v7.1.15 | Eingebauter **Orchestrator Mode** (`--auto`) |
| **qwen** | v0.13.2 | Alibaba Qwen Coder, `--system-prompt` override |

---

## Architektur: 4 Workflow-Typen

```
Claude (Orchestrator)
│
├── SIMPLE    → 1 Task → 1 Agent → Output integrieren
├── PIPELINE  → Task A → Agent1 → Output → Task B → Agent2 → merge
├── PARALLEL  → Decompose → [Agent1 | Agent2 | Agent3] → Fan-in → Merge
└── AUTO      → kilo run --auto (kilocode orchestriert intern selbst)
```

---

## Entscheidungsmatrix

| Task-Typ | Workflow | Agent | Flag |
|----------|----------|-------|------|
| Neue Komponente (1 Datei) | SIMPLE | kilocode | `--model` |
| PR Review | SIMPLE | opencode | `opencode pr <n>` |
| Code-Optimierung | SIMPLE | qwen | `--system-prompt` |
| Feature (3-5 Dateien) | PIPELINE | kilocode → qwen | sequenziell |
| Komplexes Feature (viele Dateien) | AUTO | kilocode | `kilo run --auto` |
| Parallele unabhängige Subtasks | PARALLEL | alle drei | git worktrees |
| Zweite Meinung / Review | PARALLEL | opencode + qwen | parallel |

**Aktivierungsbedingungen:**
- Task betrifft >3 Dateien ODER
- User sagt `"workflow:"` / `"multi-agent:"` ODER
- Aufgabe hat klar trennbare Subtasks

---

## Workflow-Protokoll (Claude's Ablauf)

```
1. DECOMPOSE  → Aufgabe in atomare Subtasks mit klaren Grenzen
2. ASSIGN     → Routing-Matrix → welcher Agent für welchen Subtask
3. ISOLATE    → git worktrees bei PARALLEL (Konfliktschutz)
4. EXECUTE    → Bash-Calls (parallel mit Background-Flag wo möglich)
5. COLLECT    → Outputs lesen + normalisieren
6. MERGE      → Claude synthetisiert: Konflikte auflösen, bestes nehmen
7. VALIDATE   → npx pnpm exec tsc --noEmit + manuelle Review
8. INTEGRATE  → Codebase-Konventionen (cn(), Token, kein hardcoded CSS)
```

---

## Invocation-Patterns

### SIMPLE – kilocode (neue Komponente)

```bash
kilo run \
  "Create React TypeScript component <Name>.
   Props: <list>. Use cn() from @ds/utils.
   Token vars only, no hardcoded CSS. No logic/state.
   Output: packages/ui/<name>/<name>.tsx" \
  --dir /path/to/Colabonate \
  --model anthropic/claude-opus-4-5
```

### SIMPLE – opencode (PR Review)

```bash
opencode pr 42 \
  --dir /path/to/Colabonate
```

### SIMPLE – opencode reviewer Agent (dediziert, read-only)

Konfiguration: `.opencode/agent/reviewer.md` (read-only, Repo-Konventionen eingebaut:
Tokens/cn(), TS strict, ADR-179/235/287, Key-Material-Regel). Läuft über den lokal
konfigurierten Provider (`~/.config/opencode/opencode.json`).

```bash
# Diff-Review gegen die Projekt-Konventionen
opencode run "Review the current uncommitted changes (git diff HEAD) against project conventions." \
  --dir /path/to/Colabonate \
  --agent reviewer

# Review eines einzelnen Files
opencode run "Review apps/server/services/escrow.ts for convention violations." \
  --dir /path/to/Colabonate \
  --agent reviewer
```

Output: nummerierte Findings mit `file:line`, Severity P0–P3 und `VERDICT: approve | fix-first`.

### SIMPLE – qwen (Code-Optimierung)

```bash
qwen "Optimize for performance and type-safety. Return only the improved code: <code>" \
  --system-prompt "Expert TypeScript optimizer. Output only improved code, no explanations."
```

### PIPELINE – kilocode → qwen (Feature, 3-5 Dateien)

```bash
# Schritt 1: kilocode implementiert
kilo run \
  "Implement feature: <description>. Output all changed files." \
  --dir /path/to/Colabonate \
  --model anthropic/claude-opus-4-5

# Schritt 2: qwen optimiert Output von Schritt 1
qwen "Review and optimize TypeScript types + performance in: <kilo-output>" \
  --system-prompt "Senior TypeScript reviewer. Fix types, optimize, preserve logic."
```

### AUTO – kilocode Orchestrator (komplexes Feature)

```bash
kilo run \
  "Implement <feature description with full context>" \
  --dir /path/to/Colabonate \
  --auto \
  --model anthropic/claude-opus-4-5
```

### PARALLEL – Fan-out/Fan-in mit git worktrees

```bash
# 1. Worktrees erstellen
git worktree add .worktrees/agent-kilo -b agent/kilo-task
git worktree add .worktrees/agent-qwen -b agent/qwen-task

# 2. Parallel ausführen (background)
kilo run "Frontend: <subtask A>" --dir .worktrees/agent-kilo &
qwen "<subtask B>" --system-prompt "Backend focus"  # in .worktrees/agent-qwen

# 3. Nach Fertigstellung: Claude merged via git diff
git diff agent/kilo-task agent/qwen-task
# → Claude liest diffs, wählt beste Teile, integriert

# 4. Cleanup
git worktree remove .worktrees/agent-kilo
git worktree remove .worktrees/agent-qwen
git branch -d agent/kilo-task agent/qwen-task
```

---

## Prompt-Templates pro Agent

### kilocode – Komponenten-Prompt

```
Create a React TypeScript component named <Name>.
- Props interface: <list all props with types>
- Use cn() from @ds/utils for className composition
- Use CSS custom property tokens only (var(--token-name)), no hardcoded colors/sizes
- No internal state, no side effects (headless-first)
- File: packages/ui/<name>/<name>.tsx
- Export: named export only
```

### opencode – Review-Prompt

```
Review the following code for:
1. TypeScript type safety issues
2. Performance anti-patterns
3. Missing edge case handling
4. Adherence to project conventions (cn(), token vars, no hardcoded CSS)
Return: numbered list of issues with file:line references and fix suggestions.
```

### qwen – Optimierungs-Prompt (via --system-prompt)

```
System: Expert TypeScript/React optimizer. Output only the improved code.
No explanations, no markdown fences, just the raw improved code.
Focus: type safety, performance, remove redundancy.
```

---

## Merge-Protokoll

Nach PARALLEL-Workflow:

1. `git diff agent/kilo-task agent/qwen-task` lesen
2. Für jeden Konflikt: fachlich bessere Lösung wählen
3. Convention-Check: cn(), Token-Vars, kein hardcoded CSS
4. TypeScript-Check: `npx pnpm exec tsc --noEmit`
5. Worktrees + Branches aufräumen
6. Finalen Output in main-Branch integrieren

---

## Verifikation nach Setup

```bash
# Test 1: SIMPLE kilocode
kilo run "Write: export const add = (a: number, b: number) => a + b" --dir .

# Test 2: qwen one-shot
qwen "What TypeScript utility type makes all properties optional?"

# Test 3: opencode run
opencode run "List TypeScript files in src/" \
  --dir "WORKSPACE_PATH_REDACTED/_COLABONATE/Colabonate-App/apps/colabonate-app/src"
```

Alle 3 müssen Output liefern → Setup funktioniert.

---

## CGC – Codebase-Graph für Agents

Wenn der Agent Exploration braucht (mehr als 1-2 bekannte Dateien), den CGC-Context-Block
**vor** dem Task-Prompt einfügen. Fertige Copy-Paste-Blöcke pro Agent: [CGC-AGENT-CONTEXT.md](CGC-AGENT-CONTEXT.md)

---

## Kritische Konventionen (gelten für alle Agent-Outputs)

- `cn()` aus `@ds/utils` für Klassen-Komposition
- Nur Token-Vars (`var(--token-name)`), nie hardcoded CSS
- Kein State/Logic in UI-Komponenten (headless-first)
- Alle Code-Strings in **English** (Kommentare, Variablen, Logs)
- `npx pnpm` statt direktem `pnpm`
