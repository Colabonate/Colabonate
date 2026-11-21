// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { PurchasePath } from '@col/nostr-schema'
import { PurchasePathBadge } from './PurchasePathBadge'

const CASES: Array<{ path: Exclude<PurchasePath, 'in-app-native'>; label: string; title: string }> = [
  {
    path: 'origin-link',
    label: 'Order at merchant site',
    title: 'The merchant takes orders on their own site.',
  },
  {
    path: 'open-in-client',
    label: 'View only: open in another client',
    title: 'No order link was published. Open the listing in another Nostr client to contact the publisher.',
  },
  {
    path: 'app-redirect',
    label: 'Order in merchant app',
    title: 'The merchant recommends their own app for orders.',
  },
  {
    path: 'nostr-order',
    label: 'Order via Nostr',
    title: 'Your order is sent to the merchant as an encrypted Nostr message.',
  },
  {
    path: 'nostr-auto',
    label: 'Order via Nostr',
    title: 'Your order is sent to the merchant as an encrypted Nostr message.',
  },
]

describe('PurchasePathBadge', () => {
  it('renders nothing for in-app-native', () => {
    const { container } = render(<PurchasePathBadge path="in-app-native" />)
    expect(container.firstChild).toBeNull()
  })

  for (const c of CASES) {
    it(`renders the label and data attribute for ${c.path}`, () => {
      const { container, getByText } = render(<PurchasePathBadge path={c.path} />)
      expect(getByText(c.label)).toBeInTheDocument()
      const badge = container.querySelector('[data-purchase-path]')
      expect(badge).not.toBeNull()
      expect(badge?.getAttribute('data-purchase-path')).toBe(c.path)
    })

    it(`exposes the explanation as title for ${c.path}`, () => {
      const { container } = render(<PurchasePathBadge path={c.path} />)
      const badge = container.querySelector('[data-purchase-path]')
      expect(badge?.getAttribute('title')).toBe(c.title)
    })
  }

  it('compact variant renders the same label and data attribute', () => {
    const { container, getByText } = render(<PurchasePathBadge path="nostr-order" compact />)
    expect(getByText('Order via Nostr')).toBeInTheDocument()
    const badge = container.querySelector('[data-purchase-path]')
    expect(badge?.getAttribute('data-purchase-path')).toBe('nostr-order')
    expect(badge?.getAttribute('title')).toBe(
      'Your order is sent to the merchant as an encrypted Nostr message.',
    )
  })

  it('compact variant uses the smaller type class', () => {
    const { container } = render(<PurchasePathBadge path="origin-link" compact />)
    const badge = container.querySelector('[data-purchase-path]')
    expect(badge?.classList.contains('text-[11px]')).toBe(true)
    expect(badge?.classList.contains('text-sm')).toBe(false)
  })

  it('non-compact variant keeps the default text-sm class', () => {
    const { container } = render(<PurchasePathBadge path="origin-link" />)
    const badge = container.querySelector('[data-purchase-path]')
    expect(badge?.classList.contains('text-sm')).toBe(true)
    expect(badge?.classList.contains('text-[11px]')).toBe(false)
  })

  it('renders the zap-out label, title and data attribute', () => {
    const { container, getByText } = render(<PurchasePathBadge path="zap-out" />)
    expect(getByText('Pay the seller with Lightning')).toBeInTheDocument()
    const badge = container.querySelector('[data-purchase-path]')
    expect(badge?.getAttribute('data-purchase-path')).toBe('zap-out')
    expect(badge?.getAttribute('title')).toBe(
      'You pay the seller directly over Lightning. Colabonate does not hold the payment.',
    )
  })

  it('label and title overrides apply to origin-link while data-purchase-path stays real', () => {
    const { container, getByText, queryByText } = render(
      <PurchasePathBadge path="origin-link" label="Custom label" title="Custom title" />,
    )
    expect(getByText('Custom label')).toBeInTheDocument()
    expect(queryByText('Order at merchant site')).toBeNull()
    const badge = container.querySelector('[data-purchase-path]')
    expect(badge?.getAttribute('data-purchase-path')).toBe('origin-link')
    expect(badge?.getAttribute('title')).toBe('Custom title')
  })

  it('label and title overrides are ignored for in-app-native (renders nothing)', () => {
    const { container } = render(
      <PurchasePathBadge path="in-app-native" label="Custom label" title="Custom title" />,
    )
    expect(container.firstChild).toBeNull()
  })
})
