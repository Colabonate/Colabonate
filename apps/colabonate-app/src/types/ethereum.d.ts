/**
 * Minimal EIP-1193 provider types for MetaMask browser extension integration.
 * Intentionally narrow: we only need account request and personal_sign.
 */

export interface EthereumProviderRequestArgs {
  method: string
  params?: unknown[]
}

export interface EthereumProvider {
  isMetaMask?: boolean
  request: (args: EthereumProviderRequestArgs) => Promise<unknown>
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}
