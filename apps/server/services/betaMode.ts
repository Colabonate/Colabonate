export function isBetaMode(): boolean {
  // Hard guard: demo path must never run on mainnet production (Dokploy/mainnet).
  // Exception: a closed-beta deployment that itself runs NODE_ENV=production
  // (e.g. the Surface stack behind colabonate.app) can opt in explicitly by
  // setting BETA_MODE_ALLOW_PRODUCTION=true together with BETA_MODE=true. Both
  // vars are required — a leaked BETA_MODE alone stays inert on mainnet.
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.BETA_MODE_ALLOW_PRODUCTION !== 'true'
  ) {
    return false
  }
  return process.env.BETA_MODE === 'true' || process.env.BETA_MODE === '1'
}

/**
 * True on a real production host that is NOT the declared beta deployment —
 * the same predicate `production-escrow-guard.ts` uses. Such a host runs
 * Stage-1 Direct-Pay only (ADR-253): no LNBits/LND node, therefore no
 * platform-held custodial wallet and no LNBits sub-wallets. Local dev
 * (NODE_ENV=development) and the beta stack are both exempt.
 */
export function isProductionDirectPayOnly(): boolean {
  return process.env.NODE_ENV === 'production' && !isBetaMode()
}

export interface DemoConfig {
  startBalance: number
  realLndSettle: boolean
  noticeHtml: string
}

export function demoConfig(): DemoConfig {
  return {
    startBalance: parseInt(process.env.BETA_DEMO_START_BALANCE ?? '50000', 10),
    realLndSettle: process.env.BETA_REAL_LND_SETTLE === 'on',
    noticeHtml: 'Beta mode active — demo wallet &amp; simulated payments. No real sats.',
  }
}
