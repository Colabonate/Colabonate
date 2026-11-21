/**
 * ADR-385: uniform middle-truncation for the card seller handle (npub or
 * fallback seller string) so every slider card keeps the same text width.
 *
 * `first 6` + '…' + `last 4`; values of 12 chars or fewer pass through
 * unchanged (nothing to gain from truncating).
 */
export function truncateHandle(value: string): string {
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}
