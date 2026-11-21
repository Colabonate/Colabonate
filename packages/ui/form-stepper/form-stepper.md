# FormStepper

Multi-step form container with progress bar, step indicator, dot row, slide
animations, and a footer action row. Keeps all steps mounted (`display:none`)
so intra-form state survives step hops.

## Usage

```tsx
import { FormStepper, type FormStep } from '@ds/ui'

const steps: FormStep[] = [
  { id: 0, label: 'Guide', description: 'Role & Type' },
  { id: 1, label: 'Details', description: 'Budget' },
]

<FormStepper
  steps={steps}
  currentStep={currentStep}
  onStepChange={setCurrentStep}
  onContinue={(step) => validate(step)}
  onBack={() => wizard.goBack()}
>
  {children}
</FormStepper>
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `steps` | `FormStep[]` | required | Step metadata; `id` is the index. |
| `currentStep` | `number` | required | Active step index. |
| `onStepChange` | `(step: number) => void` | — | Fired when the stepper advances internally (`goNext`). |
| `children` | `React.ReactNode[]` | required | One node per step, index-aligned with `steps`. |
| `onContinue` | `(step: number) => boolean \| void` | — | Validation hook before advancing. Returning `false` blocks and scrolls to `stepErrorAnchorRef` if provided. |
| `onBack` | `() => boolean \| void` | — | **ADR-330 D3.** When provided, footer Back, ArrowLeft and swipe-back call it instead of the internal `goPrev` — the consumer owns back semantics (e.g. URL-param cleanup). Returning `false` blocks, mirroring `onContinue`. Purely additive: consumers that don't pass it keep the built-in decrement behavior. |
| `onLastStepComplete` | `() => void` | — | Fired when Continue is pressed on the last step (only when `onContinue` doesn't return `false`). |
| `continueLabel` / `backLabel` | `string` | `'Continue'` / `'Back'` | Footer button labels. |
| `showSkip` / `onSkip` / `skipLabel` | — | `false` | Optional skip action. |
| `allowBack` | `boolean` | `true` | Enables footer Back, ArrowLeft and swipe-back. |
| `disabled` | `boolean` | `false` | Disables footer actions and keyboard nav. |
| `hideFooter` | `boolean` | `false` | Hides the footer action row. |
| `secondaryAction` | `{ label, onClick, disabled?, icon? }` | — | Left-of-Continue outlined button or icon button. |
| `stepErrorAnchorRef` | `RefObject<HTMLElement \| null>` | — | Scrolled into view when `onContinue` returns `false` (ADR-213 C3). |
| `completedSteps` | `number[]` | — | Presentational checkmark dots for caller-validated steps. |

## Behavior notes

- Keyboard (ADR-213 C3): ArrowRight/Enter advance, ArrowLeft goes back; both
  ignored while focus is inside `INPUT`/`TEXTAREA`/`SELECT`/contentEditable.
- Touch: horizontal swipe (>80px, >1.5× vertical travel) advances/goes back;
  swipe-back is additionally guarded by `!isFirst`.
- Headless: no routing, no validation logic — callbacks decide everything.

## Tokens

Colors via `var(--theme-*)` / `var(--color-*)` CSS custom properties only; no
hardcoded palette values (step accent colors use fixed rgba accents shared
with the dot row).

## Do / Don't

- **Do** pass `onBack` when the host owns URL state (e.g. `?step=` sync) so
  all three back affordances share one code path.
- **Don't** put form logic inside FormStepper — it is a presentation shell.
- **Don't** rely on step content unmounting — all children stay mounted.
