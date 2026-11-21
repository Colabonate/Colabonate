// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginTabs } from './LoginTabs'

// LoginTabs' own job is tab switching + the magic-link deeplink effect — the
// seven Tab* children each carry real auth/API logic of their own (out of
// scope here). Stub every child to a distinguishable marker so assertions
// target LoginTabs' own switching behavior, not its children's internals.
vi.mock('./TabLightning', () => ({ TabLightning: () => <div>lightning-tab</div> }))
vi.mock('./TabEmail', () => ({ TabEmail: () => <div>email-tab</div> }))
vi.mock('./TabNostr', () => ({
  TabNostr: () => <div>nostr-tab</div>,
  NewToNostrSection: () => <div>new-to-nostr</div>,
}))
vi.mock('./TabNostrConnect', () => ({ TabNostrConnect: () => <div>nostrconnect-tab</div> }))
vi.mock('./TabAlby', () => ({ TabAlby: () => <div>alby-tab</div> }))
vi.mock('./TabMetaMask', () => ({ TabMetaMask: () => <div>metamask-tab</div> }))
vi.mock('./TabNsec', () => ({ TabNsec: () => <div>nsec-tab</div> }))

describe('LoginTabs', () => {
  it('defaults to the Nostr (browser extension) tab', () => {
    render(<LoginTabs />)
    expect(screen.getByText('nostr-tab')).toBeInTheDocument()
    expect(screen.queryByText('email-tab')).not.toBeInTheDocument()
  })

  it('switches the rendered tab content via the Method select', async () => {
    const user = userEvent.setup()
    render(<LoginTabs />)
    await user.click(screen.getByLabelText('Method'))
    await user.click(await screen.findByRole('option', { name: /email/i }))
    expect(screen.getByText('email-tab')).toBeInTheDocument()
    expect(screen.queryByText('nostr-tab')).not.toBeInTheDocument()
  })

  it('switches to the Email tab on mount when the URL carries a magic-link ?token=', () => {
    const originalSearch = window.location.search
    window.history.pushState({}, '', '/?token=abc123')
    render(<LoginTabs />)
    expect(screen.getByText('email-tab')).toBeInTheDocument()
    window.history.pushState({}, '', `/${originalSearch}`)
  })
})
