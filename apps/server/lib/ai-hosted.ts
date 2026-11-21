// ADR-384: hard gate for selling hosted-AI credit packs. Purchases (and the pack
// display) stay off until an operator explicitly sets AI_HOSTED_ENABLED=true,
// which should only happen after a real hosted chat turn was verified live.
// Confirming an already-issued invoice is never gated: someone who paid must
// always get their credits.
export function aiHostedEnabled(raw: string | undefined = process.env.AI_HOSTED_ENABLED): boolean {
  const v = raw?.trim().toLowerCase()
  return v === 'true' || v === '1'
}
