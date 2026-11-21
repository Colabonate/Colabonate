# CardImage

## Purpose

Image area for list/slider cards with an elegant loading state. While the browser loads (or queues) the image, a theme-aware wave shimmer fills the area — the raw alt/title string is never painted into the card. On load the image crossfades in; on load error or when no `src` is given, a caller-provided `fallback` (e.g. the initial-letter placeholder) is rendered.

Used by all `CARD_THEME` card consumers (`SliderList` provider/ticket/offer/partner cards, `BaseOfferCard`, sell dashboards).

## Usage

```tsx
import { CardImage, CARD_THEME } from '@ds/ui';

<CardImage
  className="w-full h-[120px] rounded-t-xl"
  src={item.avatarUrl}
  alt={item.title}
  imgClassName="group-hover:scale-[1.06]"
  fallback={
    <span
      className="absolute inset-0 flex items-center justify-center leading-none select-none"
      style={{
        fontSize: CARD_THEME.text.placeholderSize,
        fontWeight: CARD_THEME.text.placeholderWeight,
        color: CARD_THEME.colors(theme).placeholder,
      }}
    >
      {item.title.charAt(0).toUpperCase()}
    </span>
  }
/>
```

## Props

| Prop          | Type                              | Default | Description                                            |
| ------------- | --------------------------------- | ------- | ------------------------------------------------------ |
| `src`         | `string \| undefined`             | –       | Image source; `undefined` shows `fallback` immediately |
| `alt`         | `string`                          | –       | Alt text for the `<img>`                               |
| `fallback`    | `ReactNode`                       | –       | Rendered on load error / missing `src`                 |
| `imgClassName`| `string`                          | –       | Extra classes for the inner `<img>` (hover zoom etc.)  |
| + all native `<div>` attributes |                     |         |                                                        |

## Tokens

| Token                      | Usage                                        |
| -------------------------- | -------------------------------------------- |
| MUI palette (`grey` scale) | Skeleton shimmer color (theme-synced)        |
| – (none hardcoded)         | All card chrome stays with `CARD_THEME`      |

## Do ✅

- Pass **sizing only** in `className` (`w-full h-full`) — the card's sized image box is
  the anchor; the component root is the `relative` positioning context for
  img/skeleton/fallback
- Keep the existing initial-letter design inside `fallback` for no-image cards
- Pass hover zoom via `imgClassName` (`group-hover:scale-[1.06]`) — it composes with the load fade

## Don't ❌

- **Never pass positioning utilities in `className`** (`absolute inset-0` etc.) — `cn()`
  does not merge conflicting classes, so base `relative` + caller `absolute` both survive
  and stylesheet order decides; the first shipped version collapsed to 0px height this way
  (ADR-280 D2)
- Don't rely on the browser alt text as a loading state (that is the bug this component fixes)
- Don't add logic/state to `CardImage` from outside — it is self-contained
