# Modal Components

## Overview

Das Global Modal System bietet eine konsistente, token-basierte Wrapper-Schicht um MUIs `Dialog`-Komponente mit blurrigem Backdrop, radialer Abdunkelung und Responsive-Design.

## Komponenten

### Modal (Hauptkomponente)

Die Basis-Komponente für alle Modal-Dialoge.

```tsx
import { Modal, ModalActions, ModalContent } from '@ds/ui';

<Modal
  open={isOpen}
  onClose={handleClose}
  title="Dialog Title"
  size="sm"
  actions={
    <ModalActions
      cancel={{ onClick: handleClose }}
      confirm={{ onClick: handleConfirm, loading: isSubmitting }}
    />
  }
>
  <ModalContent>
    {/* Content */}
  </ModalContent>
</Modal>
```

**Props:**

| Prop | Typ | Default | Beschreibung |
|------|-----|---------|--------------|
| `open` | `boolean` | – | Modal visibility state |
| `onClose` | `() => void` | – | Callback when modal should be closed |
| `title` | `ReactNode` | – | Modal title (renders in header) |
| `children` | `ReactNode` | – | Modal content |
| `actions` | `ReactNode` | – | Optional actions (ModalActions) |
| `size` | `sm \| md \| lg \| full` | `sm` | Modal max width preset |
| `blurryBackdrop` | `boolean` | `true` | Enable blurry backdrop with radial gradient |
| `disableEscapeKeyDown` | `boolean` | `false` | Disable escape key to close |
| `disableBackdropClick` | `boolean` | `false` | Disable backdrop click to close |

### ModalHeader

Wiederverwendbarer Header mit Title, Subtitle und Close-Button.

```tsx
import { Modal, ModalHeader } from '@ds/ui';

<Modal open={open} onClose={onClose}>
  <ModalHeader
    title="Dialog Title"
    subtitle="Optional subtitle"
    onClose={handleClose}
    actions={<Chip label="New" />}
  />
  <ModalContent>...</ModalContent>
</Modal>
```

**Props:**

| Prop | Typ | Default | Beschreibung |
|------|-----|---------|--------------|
| `title` | `ReactNode` | – | Header title |
| `subtitle` | `ReactNode` | – | Optional subtitle |
| `onClose` | `() => void` | – | Callback when close button clicked |
| `hideCloseButton` | `boolean` | `false` | Hide close button |
| `actions` | `ReactNode` | – | Additional actions (left side) |

### ModalActions

Wiederverwendbare Actions mit Cancel/Confirm Buttons.

```tsx
import { ModalActions } from '@ds/ui';

<ModalActions
  cancel={{ onClick: handleClose, children: 'Abbrechen' }}
  confirm={{
    onClick: handleConfirm,
    children: 'Bestätigen',
    loading: isSubmitting,
    color: 'success'
  }}
/>
```

**Props:**

| Prop | Typ | Default | Beschreibung |
|------|-----|---------|--------------|
| `cancel` | `object` | – | Cancel button config |
| `cancel.onClick` | `() => void` | – | Click handler |
| `cancel.children` | `ReactNode` | `'Abbrechen'` | Button text |
| `cancel.disabled` | `boolean` | `false` | Disabled state |
| `cancel.hidden` | `boolean` | `false` | Hide button |
| `confirm` | `object` | – | Confirm button config |
| `confirm.onClick` | `() => void` | – | Click handler |
| `confirm.children` | `ReactNode` | `'Bestätigen'` | Button text |
| `confirm.disabled` | `boolean` | `false` | Disabled state |
| `confirm.loading` | `boolean` | `false` | Loading state |
| `confirm.color` | `primary \| success \| error \| warning` | `primary` | Button color |
| `align` | `left \| center \| right \| space-between` | `right` | Actions alignment |

### ModalContent

Content-Wrapper mit konsistentem Padding.

```tsx
import { ModalContent } from '@ds/ui';

<ModalContent disablePadding>
  <Typography>Content without padding</Typography>
</ModalContent>
```

**Props:**

| Prop | Typ | Default | Beschreibung |
|------|-----|---------|--------------|
| `children` | `ReactNode` | – | Content children |
| `disablePadding` | `boolean` | `false` | Remove default padding |
| `className` | `string` | – | Custom className |

## Size Presets

| Size | Max Width | Use Case |
|------|-----------|----------|
| `sm` | 600px | Standard dialogs (forms, confirmations) |
| `md` | 800px | Medium content (tables, lists) |
| `lg` | 1000px | Large content (complex forms) |
| `full` | 1200px | Full-width content (dashboards) |

## Design Tokens

Der Modal-Wrapper verwendet folgende Tokens:

| Token | CSS Variable | Default |
|-------|--------------|---------|
| Border Radius | `--radius-lg` | `12px` |
| Box Shadow | `--shadow-xl` | `0 20px 25px -5px rgba(0,0,0,0.1)` |
| Backdrop Blur | `blur(4px)` | – |
| Background | `--bg-subtle` | `#fff` |
| Text Primary | `--text-primary` | `#1a1a1a` |
| Text Secondary | `--text-secondary` | `#4a4a4a` |

## Backdrop-Styling

Der Backdrop verwendet einen radialen Gradient mit Blur-Effekt:

```css
.MuiBackdrop-root {
  backdrop-filter: blur(4px);
  background: radial-gradient(
    circle at center,
    rgba(0, 0, 0, 0.4) 0%,
    rgba(0, 0, 0, 0.6) 100%
  );
}
```

## Responsive-Verhalten

| Breakpoint | Modal Width | Padding |
|------------|-------------|---------|
| xs (0px) | 100% | 16px |
| sm (360px) | 100% | 16px |
| md (600px) | auto, max 600px | 24px |
| lg (900px) | auto, max 600px | 24px |
| xl (1200px) | auto, max 600px | 24px |

## Beispiele

### Einfacher Bestätigungs-Dialog

```tsx
import { Modal, ModalActions, ModalContent } from '@ds/ui';
import { Typography } from '@mui/material';

function ConfirmDialog({ open, onClose, onConfirm }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bestätigen"
      actions={
        <ModalActions
          cancel={{ onClick: onClose }}
          confirm={{ onClick: onConfirm, color: 'error' }}
        />
      }
    >
      <ModalContent>
        <Typography>Möchten Sie diese Aktion wirklich ausführen?</Typography>
      </ModalContent>
    </Modal>
  );
}
```

### Formular-Dialog

```tsx
import { Modal, ModalActions, ModalContent } from '@ds/ui';
import { TextField, Box } from '@mui/material';

function FormDialog({ open, onClose, onSubmit }) {
  const [formData, setFormData] = useState({ name: '', email: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    await onSubmit(formData);
    setLoading(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Neuer Benutzer"
      size="md"
      actions={
        <ModalActions
          cancel={{ onClick: onClose }}
          confirm={{
            onClick: handleSubmit,
            children: 'Speichern',
            loading
          }}
        />
      }
    >
      <ModalContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Name"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            fullWidth
          />
          <TextField
            label="E-Mail"
            type="email"
            value={formData.email}
            onChange={e => setFormData({ ...formData, email: e.target.value })}
            fullWidth
          />
        </Box>
      </ModalContent>
    </Modal>
  );
}
```

### Wizard-Dialog mit Schritten

```tsx
import { Modal, ModalActions, ModalContent, ModalHeader } from '@ds/ui';
import { Stepper, Step, StepLabel, Box } from '@mui/material';

const STEPS = ['Grund', 'Details', 'Überprüfen'];

function WizardDialog({ open, onClose, currentStep, onNext, onBack }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      disableEscapeKeyDown={currentStep > 0}
    >
      <ModalHeader
        title="Problem melden"
        subtitle={`Schritt ${currentStep + 1} von ${STEPS.length}`}
        onClose={onClose}
      />
      <ModalContent>
        <Stepper activeStep={currentStep} sx={{ mb: 3 }}>
          {STEPS.map(label => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {/* Step content here */}
      </ModalContent>
      <ModalActions
        cancel={{ onClick: currentStep > 0 ? onBack : onClose, children: currentStep > 0 ? 'Zurück' : 'Abbrechen' }}
        confirm={{ onClick: onNext, children: currentStep < STEPS.length - 1 ? 'Weiter' : 'Abschließen' }}
        align="space-between"
      />
    </Modal>
  );
}
```

## Migration von bestehenden Dialogen

Bestehende MUI Dialog-Implementierungen können schrittweise migriert werden:

**Vorher:**
```tsx
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';

<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
  <DialogTitle>Title</DialogTitle>
  <DialogContent>Content</DialogContent>
  <DialogActions>
    <Button onClick={onClose}>Abbrechen</Button>
    <Button onClick={onConfirm}>Bestätigen</Button>
  </DialogActions>
</Dialog>
```

**Nachher:**
```tsx
import { Modal, ModalActions, ModalContent } from '@ds/ui';

<Modal
  open={open}
  onClose={onClose}
  title="Title"
  actions={
    <ModalActions
      cancel={{ onClick: onClose }}
      confirm={{ onClick: onConfirm }}
    />
  }
>
  <ModalContent>Content</ModalContent>
</Modal>
```

## Referenzen

- ADR: docs/decisions/049-global-modal-system.md
- Memory: memory/project_global_modal_system.md
- Types: [`modal.types.ts`](./modal.types.ts)
