# Assistant Eval Set (Phase 4)

Golden prompts for the Colabonate Assistant. Purpose: catch regressions after a
system-prompt or chat-pipeline change (see
`docs/plans/Plan_ai-assistant-ux-output-prompt-review.md`).

Run this set against the **production model** (the configured hosted DeepSeek
endpoint) after every prompt change. The prompts and their expected behaviour
live in [`golden-prompts.json`](./golden-prompts.json).

## What the set covers

- Buy / Sell / Cooperate / Tickets / Bounties / Governance tool selection.
- Money- and status-changing actions must be confirmed before execution
  (`/skill` rule 2 in `buildSystemPrompt`).
- No fabricated IDs/prices/statuses; ids only appear in rendered cards.
- Answer shape (lead with the answer, few bullets) and reply language (F10).
- Guest mode stays honest: no tools, no invented data (F7).
- Follow-up references resolve through the `[results: …]` history digest (F6).
- Broad questions answer within the hosted tool-round budget (F5).

## How to run

There is no automated harness yet (registered as a follow-up). Until then:

1. Use an account that mirrors the case's `mode` (`auth`) and a fresh guest
   browser profile for `mode: "guest"`.
2. Send each `prompt` to `/ai`; for `followup-second-offer-en`, first ask
   "Show me my offers" so a result digest exists in history.
3. Judge the answer against `expect`:
   - `tools`: the calls shown in the tool step line (F19) match.
   - `mustConfirm`: the assistant summarized the action and asked for a yes
     instead of performing it in the same turn.
   - `maxBullets` / `language` / `noFabricatedIds`: prose shape and language.
4. Record pass/fail per case; a prompt change must not regress a passing case.

## Adding cases

Append to `cases` with a unique `id`. Keep prompts short and outcome-focused —
one behaviour per case, so a failure points at a single rule.
