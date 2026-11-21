# MutualArbiterPanel

> Phase 2.7 (ADR-152 §A4 / PROB-002 A2) — Mutual-Arbiter UI for private-mode
> ticket disputes.

## Purpose

Private trades (`ticket.disputeMode === 'PRIVATE'`) cannot use the public
DAO-Council dispute path. Instead, the buyer and seller must nominate the
**same** trusted npub, and that npub must accept the role before any dispute
can be opened. The server-side state machine was implemented in Phase 1.6
(`apps/server/routes/dispute.ts`); this component renders it.

## Server Routes (Phase 1.6)

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/tickets/:id/nominate-arbiter` | `{ callerPubkey, arbiterPubkey }` | `{ nomination, awaiting }` |
| `POST` | `/api/tickets/:id/accept-arbiter` | `{ arbiterPubkey, arbiterSignature? }` | `{ nomination, status: 'accepted' }` |
| `GET` | `/api/tickets/:id/arbiters` | – | `{ ticket, nominations, ready_for_dispute }` |

## State Machine

```
NONE  ──── nominate-by-buyer  ──►  ONE_NOMINATED
ONE_NOMINATED  ── nominate-by-seller (same npub) ──►  BOTH_NOMINATED
ONE_NOMINATED  ── nominate-by-seller (different npub) ──►  ONE_NOMINATED  (with new candidate)
BOTH_NOMINATED  ── arbiter accepts  ──►  ACCEPTED
BOTH_NOMINATED  ── arbiter rejects  ──►  REJECTED
*   ── server 409 if disputeMode !== PRIVATE  ──►  ERROR
```

## Visual

```
┌──────────────────────────────────────────────────────────────┐
│ ⚖ Mutual Arbiter Setup         [PRIVATE TRADE]   [↻] [⌃]   │
├──────────────────────────────────────────────────────────────┤
│ Private trades don't use the public DAO-Council dispute path.│
│ Both buyer and seller must nominate the same trusted npub…  │
│                                                              │
│  ●─────────○─────────○                                        │
│ Nominate  Accept   Dispute-Ready                             │
│ Buyer &   Arbiter  Open dispute                              │
│ Seller                                                       │
│                                                              │
│ One party has nominated abc…xyz. Waiting for the seller to   │
│ nominate the same npub.                                      │
│                                                              │
│ [Nominate Arbiter]   (visible for buyer/seller when 0/2)     │
│ [Accept as Arbiter]  (visible for the nominated npub)        │
└──────────────────────────────────────────────────────────────┘
```

## Usage

```tsx
import { MutualArbiterPanel } from '../../components/disputes'

function TicketDetailView({ ticket }: { ticket: Ticket }) {
  return (
    <Box>
      {/* …other ticket sections… */}
      <MutualArbiterPanel ticket={ticket} />
      {/* …dispute button, payment, etc… */}
    </Box>
  )
}
```

## Props

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `ticket` | `Pick<Ticket, 'id' \| 'buyerPubkey' \| 'sellerPubkey' \| 'disputeMode'>` | yes | – | The ticket to display arbiter state for |
| `hideIfInactive` | `boolean` | no | `false` | If `true` and `disputeMode !== 'PRIVATE'`, render nothing |
| `refetchInterval` | `number` (ms) | no | `0` (no polling) | Optional polling interval; e.g. `15_000` for 15s |

## Roles (derived from `localStorage.getItem('pubkey')`)

- **`buyer` / `seller`** — sees the **Nominate** button. Same button is
  visible regardless of who already nominated; the server records the
  flag (`nominatedByBuyer` / `nominatedBySeller`) automatically.
- **`arbiter-candidate`** — the npub that was nominated. Once both parties
  have nominated, this person sees the **Accept as Arbiter** button.
- **`observer`** — anyone else. Sees the panel + npub-of-the-day hint.

## Tokens (no hardcoded CSS)

All colors come from the design-token system:

- Border / banner: `rgba(159,122,234,0.4)` / `rgba(159,122,234,0.04)` (matches
  the existing `PrivateOfferDetail` "Encrypted" palette)
- Step-done: `var(--color-status-success, #48BB78)`
- Step-active: `var(--color-primary-50)`
- Step-pending: `var(--theme-text-muted, #858C94)`
- Surfaces: `var(--theme-bg-subtle)`, `var(--theme-text)`

## Do / Don't

**Do:**
- Show the panel on every private-mode ticket, even before any nomination —
  the user needs to know the step exists.
- Refresh the stepper visually after every mutation (TanStack Query handles
  this via `invalidateQueries`).
- Use a **64-char lowercase hex** pubkey (matches server regex).

**Don't:**
- Don't auto-resolve npub → display name in this iteration. Phase 4+ will
  integrate L2 identity lookups.
- Don't send a `arbiterSignature` yet — the server records the row but
  doesn't verify the signature. Phase 2.8 will wire NIP-17 DM-signing.
- Don't disable the panel for `disputeMode = 'NONE'` tickets — show a
  helpful "not applicable" message instead (or set `hideIfInactive`).
- Don't show a "Dispute" button inside this panel. The dispute button is
  owned by `TicketDetailView` and reads `ticket.disputeMode` to decide
  whether to point at the public DAO-Council flow or the mutual-arbiter
  flow.

## Known Limitations (Phase 2.7)

- **No NIP-17 DM notification** to the nominated arbiter. They have to find
  the ticket via the inbox or a deep link. Phase 2.8 closes this gap.
- **No "different npub" warning** when the seller nominates an npub that
  doesn't match the buyer's choice. The server accepts it; the panel updates
  to show the new candidate. Phase 4 polish.
- **No verifier UI** for `arbiterSignature` (the body field is accepted by
  the server but ignored). Phase 2.8 will verify via NIP-44 + Gift Wrap.
