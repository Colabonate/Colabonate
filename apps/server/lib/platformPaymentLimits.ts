// ADR-387 D4 — minimum platform charge. The platform treasury (Colabonate's
// own Alby Hub) cannot mint invoices below its JIT/LSPS2 inbound-liquidity
// floor (2,501 sats for Alby's LSP). Every fixed-price platform product (AI
// credit packs, MCP passes) and the hosted-canvas service fee must therefore
// never fall below this. 2,600 sats sits comfortably above the LSP minimum and
// is ≈ $2 at $77.5k.
export const PLATFORM_MIN_PAYMENT_SATS = 2600
