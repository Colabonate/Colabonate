// @vitest-environment jsdom
import '../test/setup-component-tests'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { CartProvider, useCart } from './CartContext'

const apiCallMock = vi.fn()
vi.mock('../lib/api', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

// Simple in-memory Storage. Node's own localStorage global can shadow jsdom's,
// so both storages are stubbed explicitly.
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  } as Storage
}

const CART_KEY = 'colabonate_cart'

// Per-offer server answer: 'REMOTE' | 'LOCAL' | 'THROW' (network failure).
let serverSources: Record<string, 'REMOTE' | 'LOCAL' | 'THROW'> = {}

function legacyItem(offerId: string, extra: Record<string, unknown> = {}) {
  return {
    offerId,
    title: `Title ${offerId}`,
    priceSats: 1000,
    offerType: 'PRODUCT',
    sellerPubkey: 'seller-1',
    quantity: 1,
    ...extra,
  }
}

function Probe() {
  const { items, removedRemoteItems, addItem, dismissRemovedRemoteItems } = useCart()
  return (
    <div>
      <span data-testid="count">{items.length}</span>
      <span data-testid="items">{items.map(i => `${i.offerId}:${i.source ?? '-'}`).join(',')}</span>
      <span data-testid="removed">{removedRemoteItems.map(i => i.offerId).join(',')}</span>
      <button onClick={dismissRemovedRemoteItems}>dismiss notice</button>
      <button onClick={() => addItem({
        offerId: 'remote-add', title: 'Remote add', priceSats: 0,
        offerType: 'PRODUCT', sellerPubkey: 'seller-1', source: 'REMOTE',
      })}>add remote</button>
      <button onClick={() => addItem({
        offerId: 'local-add', title: 'Local add', priceSats: 500,
        offerType: 'PRODUCT', sellerPubkey: 'seller-1', source: 'LOCAL',
      })}>add local</button>
    </div>
  )
}

function renderProvider() {
  return render(<CartProvider><Probe /></CartProvider>)
}

let store: Storage

beforeEach(() => {
  store = memoryStorage()
  vi.stubGlobal('localStorage', store)
  vi.stubGlobal('sessionStorage', memoryStorage())
  serverSources = {}
  apiCallMock.mockReset()
  apiCallMock.mockImplementation(async (endpoint: string) => {
    const id = decodeURIComponent(endpoint.split('/').pop() ?? '')
    const source = serverSources[id] ?? 'LOCAL'
    if (source === 'THROW') throw new Error('network down')
    return { ok: true, json: async () => ({ offer: { id, source } }) }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CartProvider legacy source migration', () => {
  it('removes REMOTE legacy items and marks LOCAL ones, persisting the result', async () => {
    store.setItem(CART_KEY, JSON.stringify([legacyItem('remote-1'), legacyItem('local-1')]))
    serverSources = { 'remote-1': 'REMOTE', 'local-1': 'LOCAL' }

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('removed').textContent).toBe('remote-1'))
    expect(screen.getByTestId('items').textContent).toBe('local-1:LOCAL')
    expect(screen.getByTestId('count').textContent).toBe('1')

    await waitFor(() => {
      const saved = JSON.parse(store.getItem(CART_KEY) ?? '[]')
      expect(saved).toHaveLength(1)
      expect(saved[0].offerId).toBe('local-1')
      expect(saved[0].source).toBe('LOCAL')
    })
    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(apiCallMock).toHaveBeenCalledWith('/api/offers/remote-1')
    expect(apiCallMock).toHaveBeenCalledWith('/api/offers/local-1')
  })

  it('does not call the API again once the result is persisted', async () => {
    store.setItem(CART_KEY, JSON.stringify([legacyItem('local-1', { source: 'LOCAL' })]))

    const { unmount } = renderProvider()
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('items').textContent).toBe('local-1:LOCAL')
    unmount()

    apiCallMock.mockClear()
    renderProvider()
    await act(async () => { await Promise.resolve() })
    expect(apiCallMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('items').textContent).toBe('local-1:LOCAL')
  })

  it('keeps an item and removes nothing when its lookup fails', async () => {
    store.setItem(CART_KEY, JSON.stringify([legacyItem('flaky-1')]))
    serverSources = { 'flaky-1': 'THROW' }

    renderProvider()

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith('/api/offers/flaky-1'))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(screen.getByTestId('items').textContent).toBe('flaky-1:-')
    expect(screen.getByTestId('removed').textContent).toBe('')
    expect(JSON.parse(store.getItem(CART_KEY) ?? '[]')[0].source).toBeUndefined()
  })

  it('does not enter the basket when addItem gets a REMOTE item, but accepts LOCAL', async () => {
    renderProvider()
    expect(screen.getByTestId('count').textContent).toBe('0')

    fireEvent.click(screen.getByText('add remote'))
    expect(screen.getByTestId('count').textContent).toBe('0')

    fireEvent.click(screen.getByText('add local'))
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(screen.getByTestId('items').textContent).toBe('local-add:LOCAL')
  })

  it('drops a stored item already marked REMOTE on load without any API call', async () => {
    store.setItem(CART_KEY, JSON.stringify([legacyItem('remote-stored', { source: 'REMOTE' })]))

    renderProvider()
    await act(async () => { await Promise.resolve() })

    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('keeps the removal notice across a full reload until it is dismissed', async () => {
    store.setItem(CART_KEY, JSON.stringify([legacyItem('remote-1')]))
    serverSources = { 'remote-1': 'REMOTE' }

    const first = renderProvider()
    await waitFor(() => expect(screen.getByTestId('removed').textContent).toBe('remote-1'))
    await waitFor(() => expect(store.getItem('colabonate_cart_removed_remote')).not.toBeNull())
    first.unmount()

    // Simulated full reload (e.g. the login reload): the cart is already clean, the notice must survive.
    apiCallMock.mockClear()
    renderProvider()
    expect(screen.getByTestId('removed').textContent).toBe('remote-1')
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(apiCallMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('dismiss notice'))
    expect(screen.getByTestId('removed').textContent).toBe('')
    await waitFor(() => expect(store.getItem('colabonate_cart_removed_remote')).toBeNull())
  })

  it('ignores a corrupt stored notice instead of crashing', () => {
    store.setItem('colabonate_cart_removed_remote', '{not json')
    renderProvider()
    expect(screen.getByTestId('removed').textContent).toBe('')
  })
})
