# Footer

Zwei Footer-Varianten für die Colabonate WebApp.

## Varianten

| Variante | Verwendung |
|----------|-----------|
| `extended` | Landing Page (Home `/`) – Newsletter, 4-spaltiges Link-Grid, Copyright |
| `minimal` | Alle internen Seiten – einzeilige Copyright- und Rechtslinks-Zeile |

## Props

```typescript
interface FooterProps extends HTMLAttributes<HTMLElement> {
  variant?: 'extended' | 'minimal';  // default: 'minimal'
  newsletter?: FooterNewsletterState; // nur variant="extended"
}

interface FooterNewsletterState {
  email: string;
  onEmailChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  status?: 'idle' | 'loading' | 'success' | 'error';
  errorMessage?: string;
}
```

## Verwendung

```tsx
// Landing Page – Newsletter-State lebt im Aufrufer (headless)
<Footer
  variant="extended"
  newsletter={{ email, onEmailChange: setEmail, onSubmit: handleSubmit, status, errorMessage }}
/>

// Interne Seiten
<Footer variant="minimal" />
```

Ohne `newsletter`-Prop rendert `variant="extended"` weiterhin fehlerfrei (inerter No-op-Fallback), das Formular ist dann aber funktionslos.

## Token-Referenzen

Die Komponente verwendet ausschließlich Design-Tokens – keine hardcoded CSS-Werte:

| Token | Verwendung |
|-------|-----------|
| `--color-neutral-1` | Hintergrund (Light Mode) |
| `--color-secondary-90` | Hintergrund (Dark Mode, via MUI Theme) |
| `--color-neutral-9` | Primärtext |
| `--color-neutral-7` | Sekundärtext, Links |
| `--color-primary-50` | Link-Hover, Newsletter-Button |
| `--color-primary-70` | Newsletter-Button Hover |
| `--radius-md` | Input- und Button-Rundung |

## Aufbau Extended

- **Newsletter-Bereich**: 2-spaltig (Text + E-Mail-Input), controlled über `newsletter`-Prop; sendet an `POST /api/newsletter` (siehe `apps/colabonate-app/src/components/Footer.tsx`)
- **Link-Grid**: 4 Spalten (Desktop), 2 Spalten (Tablet), 1 Spalte (Mobile)
- **Copyright-Zeile**: Unten, zentriert

## Aufbau Minimal

- Einzeilig: Copyright · Hilfe · Datenschutz · AGB · Kontakt
- Responsive: Umbrauch auf Mobile

## Do

- `variant` prop verwenden, um die richtige Variante zu wählen
- Footer immer am Ende des `<main>`-Bereichs platzieren

## Don't

- Keine State/Logik in die Footer-Komponente einbauen (Presentation only)
- Keine zusätzlichen Props für Farben/Sizing – Token-Referenzen sind fest
- Keinen externen Code in `packages/ui/` ausführen

## Related

- [ADR-082](../../../docs/decisions/082-dual-variant-footer-component.md) – Dual-Variant Footer Component
