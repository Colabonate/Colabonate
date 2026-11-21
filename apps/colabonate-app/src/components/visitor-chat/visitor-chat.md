# VisitorChat

## Purpose

Enables sellers on BuyProductDetail to view and manage chats with all visitors who have interacted with their offer via NIP-14 kind-14 events. Shows a vertical visitor list with chat availability indicators and per-visitor unread notifications (once per visitor).

## Usage

```tsx
import { VisitorChat } from './components/visitor-chat'

<VisitorChat offerId="..." sellerPubkey="..." onVisitorNotification={(visitor) => { ... }} />
```

## Props

| Prop | Type | Description |
|------|------|-------------|
| `offerId` | `string` | The offer ID to filter chat messages |
| `sellerPubkey` | `string` | The seller's pubkey (used to check authorization) |
| `onVisitorNotification` | `(visitor: Visitor) => void` | Called once per visitor when a new unread message arrives |

## Tokens

- `--radius-lg` — border radius for container
- `--theme-border` — border color
- `--color-primary-50` — indicator dot color
- Uses MUI `background.paper` and `action.selected` for theming

## Do

- Show visitor list in left panel with chat indicator dot
- Display unread badge only when visitor has an active chat
- Show per-visitor notification once via `onVisitorNotification`
- Store messages per visitor in localStorage

## Don't

- Don't show chat to non-seller users
- Don't send duplicate notifications for the same visitor in one session
- Don't mix visitor messages from different offers