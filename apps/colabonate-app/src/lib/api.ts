export const API_URL = import.meta.env.VITE_API_URL ?? ''

export class ApiError extends Error {
  status: number
  data?: any

  constructor(status: number, message: string, data?: any) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

export interface ApiCallOptions extends RequestInit {
  /** Fetch timeout in ms. Default 30_000. Pass 0 to disable. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

export async function apiCall(endpoint: string, options?: ApiCallOptions): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options ?? {}
  const url = `${API_URL}${endpoint}`
  const isGet = !fetchOptions.method || fetchOptions.method === 'GET'
  const token = localStorage.getItem('authToken')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(fetchOptions.headers as Record<string, string> | undefined),
  }

  let signal: AbortSignal | undefined = fetchOptions.signal ?? undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  if (timeoutMs > 0) {
    const controller = new AbortController()
    timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    signal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal,
      cache: isGet ? 'no-store' : undefined,
      headers,
    })

    if (response.status === 401) {
      // Only clear the session if the token that caused this 401 is still the
      // one stored right now. A slow, stale request (e.g. WalletProvider's
      // mount-time fetchWallet firing with a leftover token from a previous
      // session) can resolve *after* a fresh login has already written a new,
      // valid token — without this guard its 401 would wipe out that brand-new
      // session and hard-redirect mid-login.
      const currentToken = localStorage.getItem('authToken')
      if (!token || currentToken === token) {
        localStorage.removeItem('authToken')
        localStorage.removeItem('pubkey')
        window.location.href = '/login'
      }
      throw new ApiError(401, 'Session expired')
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      let errorData: { error?: string; message?: string; retryAfterSeconds?: number } = {}
      try {
        const parsed = raw ? JSON.parse(raw) : {}
        errorData = typeof parsed === 'object' && parsed !== null ? parsed : { error: String(parsed) }
      } catch {
        // rate-limit 429 etc. may come back as plain text
        errorData = raw ? { error: raw.trim() } : { error: `HTTP ${response.status}` }
      }
      const retryAfterHeader = Number(response.headers.get('Retry-After'))
      if (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 && !errorData.retryAfterSeconds) {
        errorData.retryAfterSeconds = retryAfterHeader
      }
      // FU-590: prefer the server's human-readable `message` over the raw
      // error CODE — every caller across the app that displays `err.message`
      // directly (there is no code-to-text mapping table anywhere; verified
      // via grep) was showing the bare code (e.g. "ALREADY_MEMBER") whenever
      // a route sent both fields, which is the common case. `.data.error`
      // still carries the code unchanged for any caller that branches on it.
      throw new ApiError(response.status, errorData.message || errorData.error || `HTTP ${response.status}`, errorData)
    }

    return response
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
