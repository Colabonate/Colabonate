import { forwardRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Fade,
  IconButton,
  Backdrop,
  type BackdropProps,
  type Breakpoint,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { cn } from '@ds/utils';
import type { ModalProps } from './modal.types';

// ─── CustomBackdrop auf Modul-Ebene definiert ────────────────────────────────
// WICHTIG: Muss außerhalb der Modal-Render-Funktion definiert sein, damit React
// dieselbe Komponenten-Referenz über Re-Renders hinweg behält. Andernfalls
// würde MUI den Backdrop bei jedem Re-Render (z.B. Tastendruck im Textfeld)
// neu mounten → Fade-In-Animation flackert.
interface CustomBackdropProps extends BackdropProps {
  blurry?: boolean;
}

const CustomBackdrop = forwardRef<HTMLDivElement, CustomBackdropProps>(
  function CustomBackdrop({ style, blurry = true, ...props }, ref) {
    return (
      <Backdrop
        ref={ref}
        {...props}
        style={{
          ...style,
          backdropFilter: blurry ? 'blur(4px)' : 'none',
          background: blurry
            ? 'radial-gradient(circle at center, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.6) 100%)'
            : 'rgba(0, 0, 0, 0.5)',
        }}
      />
    );
  }
);

/**
 * Modal Component
 *
 * A wrapper around MUI Dialog with design token integration,
 * blurry backdrop, and responsive defaults.
 *
 * @example
 * ```tsx
 * <Modal
 *   open={isOpen}
 *   onClose={handleClose}
 *   title="Dialog Title"
 *   actions={<ModalActions cancel={...} confirm={...} />}
 * >
 *   <ModalContent>...</ModalContent>
 * </Modal>
 * ```
 */
export const Modal = forwardRef<HTMLDivElement, ModalProps>(function Modal(
  {
    open,
    onClose,
    title,
    children,
    actions,
    size = 'sm',
    blurryBackdrop = true,
    disableEscapeKeyDown = false,
    disableBackdropClick = false,
    TransitionComponent = Fade,
    TransitionProps,
    className,
    ...other
  },
  ref
) {
  // Size to maxWidth mapping
  const maxWidthMap: Record<NonNullable<ModalProps['size']>, Breakpoint> = {
    sm: 'sm',    // 600px
    md: 'md',    // 800px
    lg: 'lg',    // 1000px
    full: 'xl',  // 1200px
  };

  const maxWidth = maxWidthMap[size];

  return (
    <Dialog
      ref={ref}
      open={open}
      onClose={(_event, reason) => {
        if (reason === 'escapeKeyDown' && disableEscapeKeyDown) return;
        if (reason === 'backdropClick' && disableBackdropClick) return;
        onClose();
      }}
      fullWidth
      maxWidth={maxWidth}
      TransitionComponent={TransitionComponent}
      TransitionProps={{
        timeout: 250,
        ...TransitionProps,
      }}
      slots={{
        backdrop: CustomBackdrop,
      }}
      slotProps={{
        backdrop: { blurry: blurryBackdrop } as unknown as BackdropProps,
      }}
      className={cn('modal-root', className)}
      sx={{
        // Semantic token-based styling for Light/Dark Mode support
        '& .MuiPaper-root': {
          borderRadius: 'var(--radius-lg, 12px)',
          boxShadow: 'var(--theme-shadow, 0 2px 16px rgba(0,0,0,0.08))',
          backgroundImage: 'none',
          bgcolor: 'var(--theme-surface, var(--bg-subtle, #fff))',
        },
        // Theme-aware colors
        '& .MuiDialogTitle-root': {
          color: 'var(--theme-text, var(--text-primary, #1a1a1a))',
          fontSize: '1.25rem',
          fontWeight: 650,
        },
        '& .MuiDialogContent-root': {
          color: 'var(--theme-text-muted, var(--text-secondary, #4a4a4a))',
          fontSize: '0.9375rem',
          lineHeight: 1.6,
        },
      }}
      {...other}
    >
      {title && (
        <DialogTitle
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            pb: 2,
            pr: 1,
          }}
        >
          {title}
          <IconButton
            size="small"
            onClick={onClose}
            sx={{
              color: 'var(--theme-text-muted, var(--text-secondary, #666))',
              '&:hover': {
                color: 'var(--theme-text, var(--text-primary, #1a1a1a))',
                bgcolor: 'var(--theme-item-hover, rgba(0,0,0,0.05))',
              },
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
      )}
      <DialogContent
        sx={{
          pt: title ? 0 : 2,
          pb: actions ? 0 : 2,
        }}
      >
        {children}
      </DialogContent>
      {actions && (
        <>{actions}</>
      )}
    </Dialog>
  );
});
