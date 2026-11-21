// ADR-356: browser-side trust verification for the ICP escrow canister.
//
// L1 fact — the browser reads `/canister/<id>/module_hash` and
// `/canister/<id>/controllers` directly from an IC boundary node via
// `read_state` and verifies the certificate against the NNS root key
// (following delegations and checking the canister range). No Colabonate
// component sits in the trust path; verification succeeds with the app server
// unreachable. The root key is the SDK's embedded mainnet constant
// (`IC_ROOT_KEY`); `fetchRootKey()` is permitted only for local hosts, exactly
// as `apps/server/services/workspace-canister-client.ts` already guards.
//
// L2 (reproducible build) and L3 (attestation) are not implemented yet — see
// FU-622/FU-623. Until then `hasAttestation` is false and a verified canister
// honestly computes to `HashUnknown` ("verified on-chain, build not
// identified"), never to a green pass (ADR-356 D5).

import {
  AgentError,
  Certificate,
  CertificateNotAuthorizedErrorCode,
  CertificateTimeErrorCode,
  CertificateVerificationErrorCode,
  Cbor,
  HttpAgent,
  HttpErrorCode,
  HttpFetchErrorCode,
  MissingRootKeyErrorCode,
  getSubnetIdFromCertificate,
  lookupResultToBuffer,
  lookup_path,
  reconstruct,
  type Cert,
  type HashTree,
} from '@icp-sdk/core/agent'
import { Principal } from '@icp-sdk/core/principal'
import { bytesToHex } from '@noble/hashes/utils'

/** IC boundary-node host (mainnet default). Local replicas must override. */
export const DEFAULT_ICP_HOST = 'https://icp-api.io'

const envHost = (import.meta.env.VITE_ICP_HOST as string | undefined)?.trim()
const envEscrowCanisterId = (import.meta.env.VITE_ICP_ESCROW_CANISTER_ID as string | undefined)?.trim()
const envDaoController = (import.meta.env.VITE_ICP_ESCROW_DAO_CONTROLLER as string | undefined)?.trim()

export function defaultHost(): string {
  return envHost || DEFAULT_ICP_HOST
}

/** The platform's escrow canister, when configured. Empty until the P7 pilot
 *  canister exists — `/trade/verify` then prompts for a canister id instead. */
export function defaultEscrowCanisterId(): string | null {
  return envEscrowCanisterId || null
}

/** Declared DAO multisig controller principal (FU-253-H). Unset until decided. */
export function declaredDaoController(): string | null {
  return envDaoController || null
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type Verdict =
  | 'Unverifiable'
  | 'HashMismatch'
  | 'ControllerChanged'
  | 'HashUnknown'
  | 'VerifiedImmutable'
  | 'VerifiedGoverned'

export type ControllerDisposition = 'blackhole' | 'dao-multisig' | 'mutable'

export type FailureKind =
  | 'network'
  | 'certificate'
  | 'range'
  | 'time'
  | 'root-key'
  | 'no-module'
  | 'unknown'

export interface FailureReason {
  kind: FailureKind
  detail: string
}

/** Facts extracted from a successful L1 certified read. */
export interface TrustFacts {
  /** Certified module SHA-256, lowercase hex. */
  moduleHash: string
  /** Certified controller principal set, as text. */
  controllers: string[]
  /** Published attestation hash, when the L3 service was consulted. */
  attestationHash: string | null
  /** True when the L3 attestation service was consulted at all. */
  hasAttestation: boolean
  /** Last persisted controller snapshot (null = no prior snapshot). */
  previousControllers: string[] | null
  /** Liveness overlay: cycles below the safe margin. */
  livenessDegraded: boolean
}

export interface VerdictResult {
  verdict: Verdict
  controllerDisposition: ControllerDisposition
  livenessDegraded: boolean
}

export type VerificationOutcome =
  | { status: 'verified'; facts: TrustFacts; verdict: VerdictResult; subnetId: string | null; verifiedAt: number }
  | { status: 'unverifiable'; reason: FailureReason; verifiedAt: number }

export interface VerifyOptions {
  host?: string
  declaredDaoController?: string | null
  /** L3 attestation result. Undefined = service not consulted (P1). */
  attestation?: { hash: string } | null
  previousControllers?: string[] | null
  livenessDegraded?: boolean
}

// ── Pure verdict computation (unit-testable, no IC calls) ────────────────────

export function controllerDisposition(
  controllers: string[],
  declaredDaoController: string | null,
): ControllerDisposition {
  if (controllers.length === 0) return 'blackhole'
  if (
    declaredDaoController
    && controllers.length === 1
    && controllers[0] === declaredDaoController
  ) return 'dao-multisig'
  return 'mutable'
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}

/**
 * Verdict per TRUST-VERIFICATION-SPEC §6. Order is significant:
 * ControllerChanged and HashMismatch take precedence over HashUnknown.
 */
export function computeVerdict(
  facts: TrustFacts,
  declaredDaoController: string | null,
): VerdictResult {
  const disposition = controllerDisposition(facts.controllers, declaredDaoController)

  if (facts.previousControllers && !sameSet(facts.previousControllers, facts.controllers)) {
    return { verdict: 'ControllerChanged', controllerDisposition: disposition, livenessDegraded: facts.livenessDegraded }
  }
  if (
    facts.hasAttestation
    && facts.attestationHash !== null
    && facts.attestationHash.toLowerCase() !== facts.moduleHash.toLowerCase()
  ) {
    return { verdict: 'HashMismatch', controllerDisposition: disposition, livenessDegraded: facts.livenessDegraded }
  }
  if (facts.attestationHash === null) {
    return { verdict: 'HashUnknown', controllerDisposition: disposition, livenessDegraded: facts.livenessDegraded }
  }
  return {
    verdict: disposition === 'blackhole' ? 'VerifiedImmutable' : 'VerifiedGoverned',
    controllerDisposition: disposition,
    livenessDegraded: facts.livenessDegraded,
  }
}

// ── Failure classification ────────────────────────────────────────────────────

function classifyError(err: unknown): FailureReason {
  if (err instanceof AgentError) {
    if (err.hasCode(CertificateTimeErrorCode)) return { kind: 'time', detail: err.message }
    if (err.hasCode(CertificateNotAuthorizedErrorCode)) return { kind: 'range', detail: err.message }
    if (err.hasCode(CertificateVerificationErrorCode)) return { kind: 'certificate', detail: err.message }
    if (err.hasCode(MissingRootKeyErrorCode)) return { kind: 'root-key', detail: err.message }
    if (err.kind === 'Transport' || err.hasCode(HttpFetchErrorCode) || err.hasCode(HttpErrorCode)) {
      return { kind: 'network', detail: err.message }
    }
    return { kind: 'unknown', detail: err.message }
  }
  return { kind: 'unknown', detail: err instanceof Error ? err.message : String(err) }
}

// ── SDK glue ──────────────────────────────────────────────────────────────────

let cachedAgent: HttpAgent | null = null
let cachedHost: string | null = null

async function getAgent(host: string): Promise<HttpAgent> {
  if (cachedAgent && cachedHost === host) return cachedAgent
  const agent = await HttpAgent.create({ host })
  if (/127\.0\.0\.1|localhost/.test(host)) {
    // Local replica has a throwaway root key; never do this against mainnet.
    await agent.fetchRootKey()
  }
  cachedAgent = agent
  cachedHost = host
  return agent
}

function pathFor(canister: Principal, leaf: string): Uint8Array[] {
  return [new TextEncoder().encode('canister'), canister.toUint8Array(), new TextEncoder().encode(leaf)]
}

function decodeControllers(bytes: Uint8Array): string[] {
  const raw = Cbor.decode<Uint8Array[]>(bytes)
  return raw.map((b) => Principal.fromUint8Array(b).toText())
}

function readSubnetId(cert: Cert, rootKey: Uint8Array): string | null {
  try {
    return getSubnetIdFromCertificate(cert, rootKey).toText()
  } catch {
    return null
  }
}

export async function verifyCanister(
  canisterId: string,
  options: VerifyOptions = {},
): Promise<VerificationOutcome> {
  const host = options.host ?? defaultHost()
  const verifiedAt = Date.now()
  const declaredDao = options.declaredDaoController !== undefined
    ? options.declaredDaoController
    : declaredDaoController()

  try {
    const agent = await getAgent(host)
    const canister = Principal.fromText(canisterId)
    const moduleHashPath = pathFor(canister, 'module_hash')
    const controllersPath = pathFor(canister, 'controllers')

    const { certificate } = await agent.readState(canister, {
      paths: [moduleHashPath, controllersPath],
    })

    const rootKey = agent.rootKey
    if (!rootKey) {
      return { status: 'unverifiable', reason: { kind: 'root-key', detail: 'No root key available.' }, verifiedAt }
    }

    // Verifies BLS against the root key, follows delegations, checks the
    // canister range, and throws on failure — the L1 trust root.
    const cert = await Certificate.create({ certificate, rootKey, principal: { canisterId: canister }, agent })

    const moduleHashBytes = lookupResultToBuffer(cert.lookup_path(moduleHashPath))
    if (!moduleHashBytes) {
      return {
        status: 'unverifiable',
        reason: { kind: 'no-module', detail: 'No module is installed on this canister (module_hash path absent).' },
        verifiedAt,
      }
    }

    const controllersBytes = lookupResultToBuffer(cert.lookup_path(controllersPath))
    const facts: TrustFacts = {
      moduleHash: bytesToHex(moduleHashBytes),
      controllers: controllersBytes ? decodeControllers(controllersBytes) : [],
      attestationHash: options.attestation?.hash ?? null,
      hasAttestation: options.attestation != null,
      previousControllers: options.previousControllers ?? null,
      livenessDegraded: options.livenessDegraded ?? false,
    }

    return {
      status: 'verified',
      facts,
      verdict: computeVerdict(facts, declaredDao),
      subnetId: readSubnetId(cert.cert, rootKey),
      verifiedAt,
    }
  } catch (err) {
    return { status: 'unverifiable', reason: classifyError(err), verifiedAt }
  }
}

// ── FU-619: consensus-certified trade read verification ─────────────────────
//
// `get_trade_certified` (canister, FU-619) hands the client a subnet-signed
// data certificate plus a CBOR Merkle witness for one trade's funding-critical
// fields. This routine proves, entirely browser-side against the IC root key,
// that the funding address/amount/state shown to the user came from consensus
// state — not from a single replica or the relaying Colabonate server
// (REQ-FLOW-05, GAP F-5). Mirrors the canister's `certification_payload`
// (`lib.rs`) byte-for-byte.

/** Wire fields the certified read binds (camelCase server view). */
export interface CertifiedTradeInput {
  canisterTradeId: string | number | bigint
  btcAddress: string
  expectedAmountSats: number | bigint
  /** Server state string, e.g. 'PENDING_FUNDING'. */
  state: string
  settledBuyerBps: number | null
  settledSellerBps: number | null
}

export type CertifiedTradeResult =
  | { verified: true; certifiedAt: number }
  | { verified: false; reason: 'no-certificate' | 'no-canister-pin' | 'canister-mismatch' | 'no-root-key' | 'certificate-invalid' | 'witness-mismatch' | 'trade-absent' | 'field-mismatch'; detail: string; certifiedAt: number }

/** Mirrors the canister's `state_cert_name` (lib.rs) — server enum → certified name. */
function certifiedStateName(input: CertifiedTradeInput): string | null {
  switch (input.state) {
    case 'PENDING_FUNDING': return 'PendingFunding'
    case 'FUNDED': return 'Funded'
    case 'RELEASED': return 'Released'
    case 'REFUNDED': return 'Refunded'
    case 'DISPUTED': return 'Disputed'
    case 'DISPUTE_SETTLED':
      if (input.settledBuyerBps === null || input.settledSellerBps === null) return null
      return `DisputeSettled:${input.settledBuyerBps}:${input.settledSellerBps}`
    default: return null
  }
}

/** Mirrors the canister's `certification_payload` — the leaf bytes under the trade's key. */
export function certificationPayload(input: CertifiedTradeInput): string | null {
  const stateName = certifiedStateName(input)
  if (stateName === null) return null
  return `colabonate-escrow-cert-v1|${input.canisterTradeId}|${input.btcAddress}|${input.expectedAmountSats}|${stateName}`
}

export async function verifyCertifiedTrade(input: {
  /** Local-replica/test override only. Production callers must NOT pass a server-supplied
   * canister id here — that would let a compromised server redirect verification to a canister
   * it controls (every canister can certify its own data). Absent, the env-pinned
   * `VITE_ICP_ESCROW_CANISTER_ID` is the trust root. */
  canisterId?: string
  /** The canister id as claimed by the API response's trade row. Must match the pinned id or
   * verification fails — a compromised server cannot forge the env pin. */
  tradeCanisterId: string | null
  certificateBase64: string | null
  witnessBase64: string | null
  trade: CertifiedTradeInput
  host?: string
}): Promise<CertifiedTradeResult> {
  const certifiedAt = Date.now()
  const base = { certifiedAt }

  if (!input.certificateBase64 || !input.witnessBase64) {
    return { verified: false, reason: 'no-certificate', detail: 'No certificate/witness relayed for this trade.', ...base }
  }
  const expectedPayload = certificationPayload(input.trade)
  if (expectedPayload === null) {
    return { verified: false, reason: 'field-mismatch', detail: `Unknown trade state for certification: ${input.trade.state}`, ...base }
  }

  // Trust-root pinning (review finding 2026-09-02): the canister id comes from the app's env
  // configuration, never from the same server response that carries certificate and witness —
  // otherwise a compromised server could consistently swap all four and verify against its own
  // canister.
  const pinnedCanisterId = input.canisterId ?? defaultEscrowCanisterId()
  if (!pinnedCanisterId) {
    return { verified: false, reason: 'no-canister-pin', detail: 'No escrow canister id pinned (VITE_ICP_ESCROW_CANISTER_ID unset).', ...base }
  }
  if (input.tradeCanisterId !== null && input.tradeCanisterId !== pinnedCanisterId) {
    return {
      verified: false,
      reason: 'canister-mismatch',
      detail: `Trade claims canister ${input.tradeCanisterId}, but the pinned escrow canister is ${pinnedCanisterId}.`,
      ...base,
    }
  }

  try {
    const host = input.host ?? defaultHost()
    const agent = await getAgent(host)
    const rootKey = agent.rootKey
    if (!rootKey) {
      return { verified: false, reason: 'no-root-key', detail: 'No root key available.', ...base }
    }

    const certificate = Uint8Array.from(atob(input.certificateBase64), (c) => c.charCodeAt(0))
    const witness = Uint8Array.from(atob(input.witnessBase64), (c) => c.charCodeAt(0))
    const canister = Principal.fromText(pinnedCanisterId)

    // 1. Certificate: BLS signature against the IC root key + freshness window.
    const cert = await Certificate.create({ certificate, rootKey, principal: { canisterId: canister } })

    // 2. Certified root hash under /canister/<id>/certified_data.
    const certifiedRoot = lookupResultToBuffer(cert.lookup_path(pathFor(canister, 'certified_data')))
    if (!certifiedRoot) {
      return { verified: false, reason: 'certificate-invalid', detail: 'certified_data path absent from certificate.', ...base }
    }

    // 3. Witness: decode the CBOR HashTree and reconstruct its root — must equal
    //    the certified root, proving the witness is part of consensus state.
    const tree = Cbor.decode<HashTree>(witness)
    const reconstructed = await reconstruct(tree)
    if (!uint8ArrayEquals(reconstructed, certifiedRoot)) {
      return { verified: false, reason: 'witness-mismatch', detail: 'Witness root does not match certified_data.', ...base }
    }

    // 4. Leaf: the trade's 8-byte big-endian id key inside the witness.
    const tradeId = BigInt(input.trade.canisterTradeId)
    const key = new Uint8Array(8)
    new DataView(key.buffer).setBigUint64(0, tradeId, false) // big-endian
    const leaf = lookupResultToBuffer(lookup_path([key], tree))
    if (!leaf) {
      return { verified: false, reason: 'trade-absent', detail: 'No certified leaf under this trade id (proof of absence).', ...base }
    }

    // 5. Payload: the certified leaf must equal the canonical payload recomputed
    //    from the fields the user is shown — the actual trust statement.
    const leafText = new TextDecoder().decode(leaf)
    if (leafText !== expectedPayload) {
      return { verified: false, reason: 'field-mismatch', detail: `Certified leaf does not match the displayed trade fields (leaf: ${leafText}).`, ...base }
    }

    return { verified: true, certifiedAt }
  } catch (err) {
    return { verified: false, reason: 'certificate-invalid', detail: err instanceof Error ? err.message : String(err), ...base }
  }
}

function uint8ArrayEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}
