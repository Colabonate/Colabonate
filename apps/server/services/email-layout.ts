// ADR-401 D9/D11 — shared inline-style shell for Colabonate transactional
// emails. Email clients ignore CSS variables and external stylesheets, so all
// styles are inline and the brand palette lives here as hex constants: this is
// the single source of email colour, kept next to the app's brand red.

export const EMAIL = {
  primary: '#E84541',
  ink: '#0f172a',
  body: '#475569',
  muted: '#64748b',
  subtle: '#94a3b8',
  surface: '#ffffff',
  bg: '#f8fafc',
  border: '#e5e7eb',
  warningBg: '#fef3c7',
  warningBorder: '#fbbf24',
  warningInk: '#92400e',
  infoBg: '#eff6ff',
  infoBorder: '#3b82f6',
  infoInk: '#1d4ed8',
} as const

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** Light header + content card. No dark backgrounds (ADR-401 D9). */
export function emailShell(headerHtml: string, contentHtml: string): string {
  return `<div style="font-family:${FONT};max-width:600px;margin:0 auto;color:${EMAIL.ink};background:${EMAIL.surface};border:1px solid ${EMAIL.border};border-radius:12px;overflow:hidden">
  <div style="background:${EMAIL.bg};padding:26px 24px;text-align:center;border-bottom:1px solid ${EMAIL.border}">
    ${headerHtml}
    <div style="margin-top:10px;font-size:13px;color:${EMAIL.muted};letter-spacing:0.4px">Trade, trust, cooperate — without the middleman.</div>
  </div>
  <div style="padding:32px 28px 8px">
    ${contentHtml}
  </div>
</div>`
}

/** Brand-red primary CTA button. */
export function emailButton(label: string, href: string): string {
  return `<p style="margin:0 0 14px"><a href="${href}" style="display:inline-block;background:${EMAIL.primary};color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;letter-spacing:0.2px">${label}</a></p>`
}

/** Text wordmark fallback when no inlined SVG logo is available. */
export function emailWordmark(): string {
  return `<div style="font-size:24px;font-weight:800;letter-spacing:-0.5px;color:${EMAIL.primary};text-align:center">Colabonate</div>`
}

/** Info / warning callout box. `bodyHtml` is trusted in-repo markup. */
export function emailNotice(kind: 'info' | 'warning', title: string, bodyHtml: string): string {
  const bg = kind === 'warning' ? EMAIL.warningBg : EMAIL.infoBg
  const border = kind === 'warning' ? EMAIL.warningBorder : EMAIL.infoBorder
  const ink = kind === 'warning' ? EMAIL.warningInk : EMAIL.infoInk
  return `<div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:18px 20px;margin:24px 0">
    <div style="font-size:12px;font-weight:700;letter-spacing:0.6px;color:${ink};text-transform:uppercase;margin:0 0 8px">${title}</div>
    <div style="font-size:13px;line-height:1.6;color:#1f2937">${bodyHtml}</div>
  </div>`
}

/**
 * Escape user-supplied text (titles, reasoning, names) before it goes into
 * email HTML. Email clients render the markup, so an unescaped value could
 * inject links or hide content in a mail sent to other people.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
