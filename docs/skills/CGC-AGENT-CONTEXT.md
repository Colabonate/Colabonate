# CGC Agent Context Block

Diesen Block **vor** dem eigentlichen Task-Prompt in jeden Agent-Aufruf einfügen,
wenn der Agent Codebase-Exploration braucht (mehr als 1-2 bekannte Dateien).

---

## Prompt Block (copy-paste ready)

```
## Codebase Query Tool (CGC) – use this before reading files

The codebase is indexed in a code graph. Query it via shell before using Read or Grep.
Always prefix with PYTHONUTF8=1.

Indexed paths:
- apps/colabonate-app/src   (React/TSX frontend, 699 functions)
- apps/server               (Node/TS backend)
- packages/ui               (design system components)
- packages/utils            (shared utilities)

Workspace aliases: @ds/ui → packages/ui, @ds/utils → packages/utils, @ds/tokens → packages/tokens

FIND before reading:
  PYTHONUTF8=1 cgc find name <name>         # where is this symbol defined?
  PYTHONUTF8=1 cgc find pattern <substr>    # substring match across all symbols
  PYTHONUTF8=1 cgc find content <keyword>   # full-text search in source

ANALYZE before tracing:
  PYTHONUTF8=1 cgc analyze callers <fn>     # who calls this function?
  PYTHONUTF8=1 cgc analyze calls <fn>       # what does this function call?
  PYTHONUTF8=1 cgc analyze deps <filepath>  # what does this file import?
  PYTHONUTF8=1 cgc analyze chain <fn1> <fn2> # call path between two functions
  PYTHONUTF8=1 cgc analyze dead-code        # unused functions/classes

WORKFLOW: query CGC first → get exact file paths and function names → only then Read those files.
Do not Read files speculatively. Do not Grep for things CGC can answer directly.

Project conventions (always apply):
- No hardcoded CSS – only var(--token-name) or Tailwind token classes
- cn() from @ds/utils for all className composition
- npx pnpm (never pnpm directly)
- Headless-first: no logic/state in UI components
- Mobile-first: 360px base (sm=360 md=600 lg=900 xl=1200)
- All code, comments, variable names in English
```

---

## Verwendung pro Agent

### kilocode

```bash
kilo run \
  "## Codebase Query Tool (CGC) – use this before reading files
  [... block einfügen ...]

  ## Task
  <dein eigentlicher Task>" \
  --dir "WORKSPACE_PATH_REDACTED/_COLABONATE/Colabonate-App" \
  --model anthropic/claude-sonnet-4-6
```

### qwen

```bash
qwen \
  "## Codebase Query Tool (CGC) – use this before reading files
  [... block einfügen ...]

  ## Task
  <dein eigentlicher Task>" \
  -y \
  --system-prompt "Senior TypeScript/React engineer. Use CGC before reading files."
```

### opencode

```bash
opencode run \
  "## Codebase Query Tool (CGC) – use this before reading files
  [... block einfügen ...]

  ## Task
  <dein eigentlicher Task>" \
  --dir "WORKSPACE_PATH_REDACTED/_COLABONATE/Colabonate-App"
```

---

## Wann einfügen?

| Situation | CGC-Block nötig? |
| --------- | ---------------- |
| Agent soll genau 1-2 bekannte Dateien ändern | Nein |
| Agent muss herausfinden WO etwas definiert ist | Ja |
| Agent muss Aufrufketten nachvollziehen | Ja |
| Agent implementiert ein Feature über mehrere Dateien | Ja |
| Agent reviewt Code / sucht Probleme | Ja |
