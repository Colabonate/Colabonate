import type { Request, ParamsFlatDictionary } from 'express-serve-static-core'

/**
 * Express 5 types default route params to string | string[]. In practice
 * Colabonate routes never use array-form params (e.g. /:file+), so we
 * narrow the dictionary to string to avoid casting at every call site.
 */
export type AppRequest = Request<ParamsFlatDictionary>

export interface AuthenticatedRequest extends AppRequest {
  authPubkey?: string
  authToken?: string
  adminPubkey?: string
}
