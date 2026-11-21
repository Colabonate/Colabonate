# TicketTile

## Purpose

Ticket-Kachel mit 3 Varianten: `overview` (Karte im Slider), `pending` (gleich wie overview), `list` (volle Breite Listen-Eintrag).

## Usage

```tsx
import { TicketTile } from '@ds/ui'

// Overview/Pending – Slider-Karte
<TicketTile
  variant="overview"
  ticket={ticket}
  statusLabel="In Bearbeitung"
  onClick={() => navigate(`/tickets/${ticket.id}`)}
/>

// List – volle Breite
<TicketTile
  variant="list"
  ticket={ticket}
  statusLabel="Abgeschlossen"
  statusColorClass="bg-success/10 text-success"
/>
```

## Props

| Prop               | Type              | Default | Description                          |
|--------------------|-------------------|---------|--------------------------------------|
| `variant`          | `overview \| pending \| list` | – | Darstellungsvariante            |
| `ticket`           | `TicketData`      | –       | Ticket-Daten                         |
| `statusLabel`      | `string`          | –       | Custom Status-Label                  |
| `statusColorClass` | `string`          | –       | Custom Tailwind Status-Farbe         |
| `onClick`          | `() => void`      | –       | Click-Handler                        |
| + alle nativen `<div>`-Attribute | | | |

### TicketData

| Feld         | Type     | Description            |
|--------------|----------|------------------------|
| `id`         | `string` | Ticket-ID              |
| `title`      | `string` | Ticket-Titel           |
| `status`     | `string` | Status-Code            |
| `amountSats` | `number` | Betrag in Satoshis     |
| `createdAt`  | `string` | Erstellt-Datum (ISO)   |

## Tokens

| Token                 | Verwendung              |
|-----------------------|-------------------------|
| `--color-surface-*`   | Karten-Hintergrund      |
| `--color-border-*`    | Karten-Border           |
| `--color-primary-*`   | Satoshi-Betrag, Icon    |
| `--color-status-*`    | Status-Farben           |

## Do ✅

- `variant="list"` für volle Breite Listen
- `variant="overview"` für Slider-Karten
- Status-Mapping aus `ticket-status-config.ts` übergeben

## Don't ❌

- Keine hardcoded Status-Farben
- Nicht ohne Wrapper (SliderList) für overview/pending
