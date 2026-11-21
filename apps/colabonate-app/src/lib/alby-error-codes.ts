/**
 * ADR-225 D3/D4: maps the `?code=` query param set by the server's
 * `/api/auth/alby` redirect-on-error (apps/server/routes/auth-alby.ts) to
 * user-facing copy for the `/login/alby/error` SPA route.
 */
export type AlbyErrorCode = 'STATE_INVALID' | 'TOKEN_EXCHANGE_FAILED' | 'NOSTR_NOT_LINKED' | 'SERVER_ERROR' | 'ACCESS_DENIED'

export interface AlbyErrorCopy {
  title: string
  body: string
}

const ALBY_ERROR_COPY: Record<AlbyErrorCode, AlbyErrorCopy> = {
  NOSTR_NOT_LINKED: {
    title: 'Your Alby account has no Nostr identity linked',
    body: 'Alby accounts pre-date Nostr support, so this is common — it does not mean anything is wrong with your account. You can link a Nostr key to Alby at getalby.com/settings and retry, or use one of the paths below to get a Colabonate-native Nostr identity in under a minute.',
  },
  STATE_INVALID: {
    title: 'The login attempt expired or was already used',
    body: 'This can happen if you opened the Alby consent screen twice, waited too long before approving, or used the browser back button mid-flow. Just try signing in with Alby again.',
  },
  TOKEN_EXCHANGE_FAILED: {
    title: 'Alby did not confirm the login',
    body: 'The connection to Alby was interrupted or Alby rejected the exchange. This is usually temporary — try again in a moment, or use a different login method below.',
  },
  SERVER_ERROR: {
    title: 'Something went wrong on our side',
    body: 'The Alby login could not complete due to a server-side issue. Please try again shortly, or use a different login method below.',
  },
  // ADR-228 D6
  ACCESS_DENIED: {
    title: 'Login cancelled',
    body: 'You cancelled the Alby consent screen — nothing was created or connected. Try again with Alby, or use a different login method below.',
  },
}

const DEFAULT_COPY: AlbyErrorCopy = ALBY_ERROR_COPY.SERVER_ERROR

export function getAlbyErrorCopy(code: string | null): AlbyErrorCopy {
  if (code && code in ALBY_ERROR_COPY) return ALBY_ERROR_COPY[code as AlbyErrorCode]
  return DEFAULT_COPY
}
