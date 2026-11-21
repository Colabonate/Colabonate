import { API_BASE } from '../config.js'

export async function callApi<T>(
  endpoint: string,
  options?: RequestInit & { token?: string }
): Promise<T> {
  const { token, ...fetchOptions } = options ?? {}
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(fetchOptions.headers as Record<string, string> | undefined),
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...fetchOptions,
    headers,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API Error: ${res.status} ${res.statusText} — ${body}`)
  }

  return res.json() as Promise<T>
}
