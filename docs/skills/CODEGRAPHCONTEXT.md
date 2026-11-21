# CodeGraphContext (CGC) – Colabonate Project

CGC indexes the codebase into a queryable graph. **Use it before reading files** to find exactly what you need — saves tokens by skipping broad Grep/Read exploration.

## Status

Indexed (293 files, 949 functions):

- `apps/colabonate-app/src` — Frontend (React/TSX)
- `apps/server` — Backend (Node/TS)
- `packages/ui` — Design system components
- `packages/utils` — Shared utilities

After editing files, re-index the changed folder:

```bash
PYTHONUTF8=1 cgc index apps/colabonate-app/src --force
```

## Token-Saving Protocol

| Instead of | Use CGC |
| ---------- | ------- |
| Grep for callers of a function | `cgc analyze callers <fn>` |
| Read multiple files to trace a call | `cgc analyze chain <fn1> <fn2>` |
| Grep for where something is defined | `cgc find name <name>` |
| Read file to check its imports | `cgc analyze deps <file>` |
| Glob + Read to find dead code | `cgc analyze dead-code` |
| Grep for all usages of a pattern | `cgc find pattern <substr>` |

## Commands (always prefix with `PYTHONUTF8=1`)

**Find:**

```bash
cgc find name <name>           # exact function/class name
cgc find pattern <substr>      # substring match across all symbols
cgc find type function         # list all functions
cgc find content <keyword>     # full-text search in source
```

**Analyze:**

```bash
cgc analyze callers <fn>       # who calls this function?
cgc analyze calls <fn>         # what does this function call?
cgc analyze chain <fn1> <fn2>  # call path between two functions
cgc analyze deps <file-path>   # imports of a file
cgc analyze dead-code          # unused functions/classes
cgc analyze complexity         # cyclomatic complexity ranking
```

**Maintenance:**

```bash
cgc stats                      # indexed file/function counts
cgc list                       # all indexed repositories
cgc index <path> --force       # re-index after edits
```

## Known Issues & Fixes

**Bug:** CGC v0.4.2 crashes on TypeScript files with `@`-prefixed workspace aliases (e.g. `@ds/utils`).  
**Fix applied:** `writer.py` patched to treat `tsx`/`typescript` imports like `javascript`. If CGC is upgraded, re-apply:

```python
# File: site-packages/codegraphcontext/tools/indexing/persistence/writer.py
# Change:
if lang == "javascript":
# To:
if lang in ("javascript", "typescript", "tsx"):
```

**Bug:** CGC crashes on Windows with emoji output (cp1252 encoding).  
**Fix:** Always prefix commands with `PYTHONUTF8=1`.

## MCP Server

Registered as project-local stdio server (`cgc mcp start`). Active when Claude Code starts. No manual start needed — Claude can call CGC tools directly via MCP during a session.
