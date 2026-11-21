# ChatRoom

Headless presentational component for multi-user public chat (NIP-28 community channel).

Unlike the 1:1 `Chat` component, `ChatRoom` renders messages from **multiple senders** with left/right alignment based on ownership. It is purely presentational — no Nostr logic, no state beyond the input draft.

## Props

| Prop           | Type                                          | Required | Description                                                  |
| -------------- | --------------------------------------------- | -------- | ------------------------------------------------------------ |
| `messages`     | `ChatRoomMessage[]`                           | Yes      | Ordered list of messages (`id`, `pubkey`, `content`, `createdAt`). |
| `myPubkey`     | `string`                                      | Yes      | Current user's pubkey — used to align own messages right.    |
| `onSendMessage`| `(content: string) => Promise<void>`          | Yes      | Called when the user sends a message.                        |
| `loading`      | `boolean`                                     | No       | Shows a loading state in the message area.                   |
| `disabled`     | `boolean`                                     | No       | Disables the input (e.g. when not logged in).                |
| `formatSender` | `(pubkey: string) => string`                  | No       | Custom sender label formatter. Defaults to abbreviated pubkey. |
| `profiles`     | `Record<string, ChatRoomProfile>`             | No       | Author display identity keyed by hex pubkey (Nostr Kind-0 `name` + `picture`). Falls back to initials + abbreviated pubkey. |
| `formatTimestamp` | `(createdAt: number) => string`            | No       | Custom timestamp formatter (date + time). Defaults to a short locale string. |
| `className`    | `string`                                      | No       | Extra classes for the root container.                        |

## Tokens Used

- `--theme-surface`, `--theme-surface-secondary`
- `--theme-text`, `--theme-text-muted`
- `--theme-border`
- `--color-primary`

## Do

- Pass messages sorted by `createdAt` ascending.
- Deduplicate by `id` before passing — the component does not dedup.

## Don't

- Add Nostr/relay logic inside this component — keep it headless.
- Hardcode CSS values — use `var(--*)` tokens only.
