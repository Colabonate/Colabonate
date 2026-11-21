import type { HTMLAttributes } from 'react'

export interface BusinessField {
  id?: string
  name: string
  slug?: string
  unspscCode?: string | null
}

export interface BusinessFieldsChipsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** `Company.businessFields` (Json) — already parsed to an array by the API. */
  fields?: BusinessField[] | null
  /** Section header label (default: "Business Fields"). */
  label?: string
  /** Show the tag icon. */
  showIcon?: boolean
}
