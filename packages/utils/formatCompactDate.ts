/**
 * ADR-385: compact creation-date label shared by the card surfaces
 * (SliderList card theme + the marketplace/coop/vendor browse cards).
 *
 * Format is fixed `dd.mm.yy` by product request (not locale-derived), so the
 * label is identical on every surface. Returns '' for missing/invalid input so
 * callers can conditionally render (`formatCompactDate(x) && ...`).
 */
export function formatCompactDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}.${mm}.${yy}`
}
