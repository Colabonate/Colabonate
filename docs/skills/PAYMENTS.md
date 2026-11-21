# Skill: Payment Error Contract

How `POST /api/tickets` (and other ticket-flow endpoints) report errors to the
frontend. Stable contract — branch on `code`, not on `error` text.

**Source:** [ADR-179](../decisions/179-nostr-login-wallet-bootstrap-ticket-error-reporting.md)
(ADR-179 Fix A, 2026-06-18). Implemented in `apps/server/routes/tickets.ts`.

---

## Why this exists

Before 2026-06-18, `POST /api/tickets` returned
`{ "error": "Failed to create ticket" }` for **every** 5xx, hiding the actual
upstream cause (LNBits amount-limit, DB unique violation, missing Wallet, etc.).
A tester saw the same string in the UI and in the browser console; the real
reason lived only in server `console.error` nobody reads.

After ADR-179, every non-2xx response carries a stable `code` field. Frontend
code must switch on `code` for user-facing copy.

---

## Response shape

Every error response follows this shape (backwards-compatible — `error` is
preserved):

```json
{
  "error": "<human-readable message>",
  "code": "<stable-machine-readable code>",
  "details": "<optional, technical detail for debugging>"
}
```

`code` values for `POST /api/tickets`:

| HTTP | `code`                   | Trigger                                                          | UI action                                                                                                                                              |
|------|--------------------------|------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| 400  | `BAD_REQUEST`            | Missing `offerId`, invalid visibility tier                       | Show `error` text                                                                                                                                     |
| 400  | `WALLET_REQUIRED`        | Buyer has no `Wallet` row and strategy ≠ `NONCUSTODIAL_ONLY`      | **Show wallet-required banner**: "Sign in with Lightning, or create a wallet in Settings → Wallet before placing orders." Offer link to `/settings/wallet`. |
| 400  | `TX_ABOVE_LAUNCH_CAP`    | `offer.priceSats` > `LAUNCH_MAX_TX_SATS` (default 210,000 since 2026-09-05, originally 25,000; ADR-252 D2, FU-655). Body also carries `capSats` + `amountSats`. Same code on fund-escrow, release-payment, `/api/lightning/invoice`, workspace funding/recharge. | Show "above the launch-phase limit of {capSats} sats" — no retry, no wallet prompt. |
| 401  | `UNAUTHORIZED`           | Missing / expired Bearer token                                   | Redirect to login                                                                                                                                      |
| 404  | `NOT_FOUND`              | Offer does not exist                                             | Show "This offer is no longer available"                                                                                                              |
| 502  | `PAYMENT_UPSTREAM_ERROR` | `payments.createInvoice(...)` threw (LNBits / Lightspark / NWC)   | Show "Payment provider temporarily unavailable. Try again in a moment." + optional `details` for debugging (dev only)                                  |
| 500  | `DB_ERROR`               | `prisma.ticket.create()` threw                                   | Show "Something went wrong on our side. Please try again." + log the user agent for support.                                                          |

`details` is **debug-only** during closed Beta (FU-26 tracks sanitisation
before public launch).

---

## Frontend usage

```ts
const res = await apiCall('/api/tickets', { method: 'POST', body: JSON.stringify(payload) })
if (!res.ok) {
  const err = await res.json()
  switch (err.code) {
    case 'WALLET_REQUIRED':
      showWalletRequiredBanner(err.details)
      break
    case 'PAYMENT_UPSTREAM_ERROR':
      showTransientError(err.details)
      break
    case 'DB_ERROR':
      showServerError()
      break
    default:
      showGenericError(err.error)
  }
}
```

---

## Pre-flight wallet check

The endpoint reads `User.wallet` before calling `payments.createInvoice()`. If
the buyer has no wallet row AND their `walletModeStrategy !== 'NONCUSTODIAL_ONLY'`,
the endpoint returns `400 WALLET_REQUIRED` without ever contacting LNBits.

The `NONCUSTODIAL_ONLY` strategy is the opt-out for users who run their own
Lightning wallet (WebLN or NWC, ADR-208). They are not blocked by the
pre-flight — checkout dispatches by `wallet.provider` (see below) instead of
going through `payments.createInvoice()` for those wallets.

---

## Wallet payment paths: platform backend vs user wallet (ADR-208)

Two separate concerns, easy to conflate:

| Concern | Component | Role |
|---|---|---|
| Platform escrow backend | `PaymentProvider` (LNBits + LND) via `createProvider()`, a process-wide singleton | Issues/holds/settles the invoices tickets are paid into |
| User spending wallet | `WalletProvider.WEBLN` / `NWC` / `CASHU` on the `Wallet` row | Pays the invoice presented at checkout |

`NWC` (Nostr Wallet Connect, NIP-47) is **not** a `PaymentProvider` and never touches `createProvider()` — it's a peer of `WEBLN`, added in `WalletContext.sendPayment()`'s dispatch (`apps/colabonate-app/src/contexts/WalletContext.tsx`):

```ts
if (wallet.mode === 'NON_CUSTODIAL' && wallet.provider === 'WEBLN') { /* window.webln.sendPayment */ }
if (wallet.mode === 'NON_CUSTODIAL' && wallet.provider === 'NWC')   { /* POST /api/wallet/nwc/pay */ }
/* else: custodial → POST /api/wallet/payments/send */
```

**Hold-invoice caveat:** a genuine Lightning hold invoice (ADR-184's 3-phase escrow) doesn't resolve its payment promise until the receiver settles or cancels — true for `window.webln.sendPayment()` and NWC's `payInvoice()` alike. Because of this, `POST /api/tickets`'s hold invoice is still paid out-of-band (QR/copy in `TicketDetailView.tsx`) for every wallet type today; `WalletContext.sendPayment()`/`POST /api/wallet/nwc/pay` only handle **normal** (settle-on-receipt) invoices — release-payment, milestone-release, cooperation fund-escrow. Programmatic hold-invoice payment is tracked as [ADR-209](../decisions/209-hold-invoice-programmatic-wallet-payment.md) (proposed, not built).

Full design: [ADR-208](../decisions/208-alby-nostr-wallet-connect-nwc-integration.md).

---

## Adding new endpoints to this contract

Two patterns:

1. **Inline classification** — for one-off endpoints, branch on the error type
   in the catch block (see `apps/server/routes/tickets.ts:127-156`).
2. **Generic middleware** — DRY helper that wraps a handler and applies the
   `{ error, code, details }` shape based on the thrown error's name/code.
   Tracked as FU-27 in FOLLOWUPS.md (build when 3+ more endpoints need this).

**Rule:** never return a generic 500 without a `code`. Frontend developers
cannot switch on a free-text `error` string and the only fallback is to show
the raw message verbatim — which leaks operational detail (FU-26).

---

## Test reference

`apps/server/src/__tests__/ticket-errors.test.ts` — 5 cases covering:
- T1: no Wallet row → 400 `WALLET_REQUIRED`
- T2: LNBits throws → 502 `PAYMENT_UPSTREAM_ERROR` (message preserved)
- T3: Prisma throws → 500 `DB_ERROR`
- T4: happy path → 200
- T5: `NONCUSTODIAL_ONLY` bypasses the pre-flight → 502 (not 400)
