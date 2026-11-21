import { forwardRef } from 'react';
import { Button, CircularProgress, DialogActions } from '@mui/material';
import type { ModalActionsProps } from './modal.types';
import type { ButtonProps } from '@mui/material';

/**
 * ModalActions Component
 * 
 * Reusable modal actions with cancel and confirm buttons.
 * Provides consistent styling and loading states.
 * 
 * @example
 * ```tsx
 * <ModalActions
 *   cancel={{ onClick: handleClose, children: 'Abbrechen' }}
 *   confirm={{ onClick: handleConfirm, children: 'Bestätigen', loading: isSubmitting }}
 * />
 * ```
 */
export const ModalActions = forwardRef<HTMLDivElement, ModalActionsProps>(
  function ModalActions(
    {
      cancel,
      confirm,
      children,
      align = 'right',
    },
    ref
  ) {
    // If custom children are provided, render them instead
    if (children) {
      return (
        <DialogActions
          ref={ref}
          sx={{
            px: 3,
            pb: 3,
            gap: 1.5,
            justifyContent: align === 'left' ? 'flex-start'
              : align === 'center' ? 'center'
              : align === 'space-between' ? 'space-between'
              : 'flex-end',
          }}
        >
          {children}
        </DialogActions>
      );
    }

    return (
      <DialogActions
        ref={ref}
        className="modal-actions"
        sx={{
          px: 3,
          pb: 3,
          gap: 1.5,
          justifyContent: align === 'left' ? 'flex-start'
            : align === 'center' ? 'center'
            : align === 'space-between' ? 'space-between'
            : 'flex-end',
        }}
      >
        {/* Cancel Button */}
        {cancel && !cancel.hidden && (
          <Button
            variant="outlined"
            onClick={cancel.onClick}
            disabled={cancel.disabled}
            sx={{
              minWidth: 100,
            }}
          >
            {cancel.children || 'Abbrechen'}
          </Button>
        )}

        {/* Confirm Button */}
        {confirm && !confirm.hidden && (
          <Button
            variant="contained"
            color={confirm.color || 'primary'}
            onClick={confirm.onClick}
            disabled={confirm.disabled || confirm.loading}
            startIcon={
              confirm.loading ? (
                <CircularProgress size={16} color="inherit" />
              ) : (confirm.startIcon as ButtonProps['startIcon'])
            }
            sx={{
              minWidth: 120,
            }}
          >
            {confirm.loading ? 'Wird verarbeitet…' : confirm.children || 'Bestätigen'}
          </Button>
        )}
      </DialogActions>
    );
  }
);
