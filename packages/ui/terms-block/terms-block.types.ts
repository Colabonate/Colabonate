import type { HTMLAttributes } from 'react'

export interface TermsBlockProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** `Company.terms` — markdown or plain text, rendered read-only. */
  terms?: string | null
  /** Section header label. Omit to render the terms text only. */
  label?: string
  /** Show the gavel icon. */
  showIcon?: boolean
}
