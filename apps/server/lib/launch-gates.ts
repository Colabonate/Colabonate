// Product-Launch-Masterplan Go-Launch-Gate table
// (docs/plans/PRODUCT-LAUNCH-MASTERPLAN.md §"Go-LAUNCH-Gate", G1-G10).
//
// This is a MANUALLY MAINTAINED snapshot for the Admin "Launch Readiness"
// panel (FU-681), not a live probe — most gates are founder/operator
// decisions (pentest execution, hosting, backups) that no server-side check
// can verify. Mirrors PRODUCT-LAUNCH-MASTERPLAN.md §9.2's compact gate table
// (the authoritative source) as of 2026-09-25. Keep this in sync whenever a
// gate's status changes there — there is deliberately no automated sync
// (parsing the masterplan/FOLLOWUPS.md at runtime would be far more fragile
// than a maintainer updating one array).

export type LaunchGateStatus = 'done' | 'partial' | 'open'
export type LaunchGateOwner = 'Code' | 'Op' | 'F' | 'Op+F' | 'Code+F' | 'F+Op' | 'Code+Op'

export interface LaunchGate {
  id: string
  label: string
  owner: LaunchGateOwner
  status: LaunchGateStatus
  precondition: string
  subPlan: string
  note: string
}

export const LAUNCH_GATES: LaunchGate[] = [
  {
    id: 'G1',
    label: '210k-sats cap enforced at all money entry points',
    owner: 'Code',
    status: 'partial',
    precondition: '—',
    subPlan: '01',
    note: 'FU-655 shipped + unit/live-smoke tested. Live cap probe on the prod host at cutover still open.',
  },
  {
    id: 'G2',
    label: 'Rate-limit decision for unauth/search made + shipped',
    owner: 'Code',
    status: 'done',
    precondition: '—',
    subPlan: '01',
    note: 'FU-252-E — live load-tested 120/min (unauth) + 240/min (auth), both limits proven.',
  },
  {
    id: 'G3',
    label: 'Pentest: 0 Critical/High open',
    owner: 'F',
    status: 'done',
    precondition: '—',
    subPlan: '02',
    note: 'Founder decided to self-conduct (2026-09-05), same scope/template as PENTEST-SCOPE.md. Executed 2026-09-17: multi-agent-orchestrated (OpenCode CLI, 5 parallel read-only sub-agents, one per scope cluster — Auth/Session, Payment/Money-Flow, Network/Infrastructure, Data, Nostr Protocol). 0 open Critical/P0 — 3 P0s (DM-inbox IDOR, 2x missing verifyEvent() on inbound Nostr ingestion) + 1 P1 (payment kill-switch gap) fixed and live-deployed same day, live-verified post-deploy. All 5 remaining P1s (FU-710/718/719/720/725) also closed the same day, well inside the 30-day SLA (commit ae2d98a) — only P2/P3 backlog remains, tracked in FOLLOWUPS.md §EB. Findings report: docs/security/pentest-payment-flow.md + FOLLOWUPS.md §EB. Closes FU-212-D. 2026-09-25: all of these fixes (ae2d98a, c072b3f, FU-738, FU-725 Caddy rebuild) are verified in the live release (git ancestry of the deployed tag; live since the 2026-09-18+ redeploys).',
  },
  {
    id: 'G4',
    label: 'Alerting: test CRITICAL delivered + on-call plan named',
    owner: 'Op',
    status: 'partial',
    precondition: 'G6',
    subPlan: '02, 05',
    note: 'Mechanism + admin test-trigger (POST /api/admin/alerts/test) shipped. 2026-09-14: beta host env-wired + live drill delivered via verify-critical-alert.sh. 2026-09-15 (founder): recipient decision superseded — admin inbox is info@colabonate.com. 2026-09-16: re-confirmed live on the prod host — RESEND_API_KEY + CRITICAL_ALERT_EMAIL=info@colabonate.com configured, test alert delivered and founder-confirmed. FU-252-A done. Remaining for G4: the on-call table (Masterplan E6) — founder decision 2026-09-17: deliberately deferred until a dedicated, actually-responding email address exists for CRITICAL mail (not just a named person). Not a blocker for other work, only for formal G4 sign-off.',
  },
  {
    id: 'G5',
    label: 'Backup-key redundancy + restore drill with 2nd custody location',
    owner: 'F+Op',
    status: 'partial',
    precondition: '—',
    subPlan: '02',
    note: 'FU-252-B code+doc shipped 2026-09-07: dual-recipient backup (AGE_PUBLIC_KEY_2), dual-custody restore-drill.sh, RESTORE-DRILL.md "Second custody". 2026-09-17 (FU-739): production backup pipeline built + live-verified end-to-end on the Netcup host — cron dump (03:00 UTC) + encrypted pull to the operator machine + a real restore drill (RTO 5s, PASS). The age decryption identity was deliberately generated off the server, never on it. Remaining, founder-only: a physical 2nd custody location for the identity + an off-site (Ebene 3) copy.',
  },
  {
    id: 'G6',
    label: 'Prod host live, prod compose, fresh secrets, DB strategy executed, /trade/* gated',
    owner: 'Op+F',
    status: 'done',
    precondition: '—',
    subPlan: '03',
    note: '/trade/* gate shipped (FU-662 done, 2026-09-05). 2026-09-16: https://colabonate.app is LIVE with a real Let\'s Encrypt certificate — /health verified 200 from outside, DB/redis/meilisearch ok, real Nostr relay set connected. DB seed chain executed same day (FU-663 done — Foundation DAO + 67 standard categories + redis flush), triggered by a real user report (empty homepage, no admin access — root-caused as an empty DB, not a bug: all three APIs already returned clean 200s with empty arrays). Gotchas along the way: DNS change only covered the A record at first (Let\'s Encrypt prefers AAAA when one exists); SEO prerender base-URL defaulted to colabonate.app (fixed via new SITE_URL build arg); a second LNBits boot guard in packages/payments (separate from the escrow guard) needed fake-but-present values. Runbook: docs/PRODUCTION-SERVER.md. E3 (single-instance sign-off) confirmed by the founder 2026-09-17 — Gate G6 fully closed. Separately found+fixed the same day (FU-738): production silently inherited the Beta-badge/BetaSection default from a missing VITE_BETA_BADGE Docker ARG — pinned false in docker-compose.production.yml. Live since 2026-09-18 (VITE_BETA_BADGE ARG later removed entirely when the beta host was retired, 2026-09-23).',
  },
  {
    id: 'G7',
    label: 'Nostr publish on real relays',
    owner: 'Code+Op',
    status: 'done',
    precondition: 'G6',
    subPlan: '03',
    note: 'FU-658 code shipped 2026-09-07 (relay set ribo/damus/nos.lol/primal, timeout unit test, live smoke 6/6). Closed 2026-09-25 on live evidence: docker-compose.production.yml hard-pins NOSTR_MOCK_RELAY_ENABLED="false" and the real relay set; /health reports 4 connected relays on colabonate.app.',
  },
  {
    id: 'G8',
    label: 'Cutover executed: BETA_MODE=false, COOP_ESCROW_ENABLED off, kill-switch drill passed',
    owner: 'Op',
    status: 'done',
    precondition: 'G1-G7, G10 decisions',
    subPlan: '04',
    note: 'Cutover flags verified live 2026-09-25: GET /api/beta/status → betaMode:false, coopEscrowEnabled:false; docker-compose.production.yml hard-pins BETA_MODE, BETA_MODE_ALLOW_PRODUCTION, COOP_ESCROW_ENABLED and ESCROW_ENABLED to "false" (boot-time custodial-escrow guard FU-668). Kill-switch drill passed live 2026-09-25 (paused 15:29:49–15:31:16 UTC): the drill first found that the prod compose never forwarded PAYMENTS_PAUSED to the server container (no env_file) — the switch was unreachable on prod; fixed (FU-877), then authenticated probe apps/server/scripts/g8-kill-switch-probe.ts: open → paused (POST /api/tickets + fund-escrow → 503 PAYMENTS_PAUSED, boot canary logged) → open again; prod smoke 7/7 afterwards.',
  },
  {
    id: 'G9',
    label: 'Prod smoke green with a real payment leg + cap-probe over cap → 400',
    owner: 'Op',
    status: 'partial',
    precondition: 'G8',
    subPlan: '04',
    note: 'smoke-test-production.sh runs on every production redeploy (5/5 green on v0.6.2, 2026-09-24/25; opt-in platform-rail roundtrip FU-802 green 2026-09-20). Remaining: the real payment leg (FU-252-D, needs a pre-provisioned test account) and the over-cap probe (→ 400) shared with G1.',
  },
  {
    id: 'G10',
    label: 'GDPR export + 502-passthrough check green; demo-wallet purge decided',
    owner: 'Code+F',
    status: 'done',
    precondition: 'decisions before G8, verification after G8',
    subPlan: '02, 04',
    note: 'GDPR export completeness + 502 passthrough fixed (Sub-Plan 02 §2.5). Demo-wallet purge formally N/A: fresh production DB (FU-663, 2026-09-16) and verified 2026-09-25 — 0 DEMO wallets on the prod DB (wallet rows: ALBY_OAUTH, CASHU, LNBITS, WEBLN only). Closes the FU-197-D / FU-255-C cutover purge question.',
  },
]
