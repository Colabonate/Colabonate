import { forwardRef } from 'react';
import { DialogContent } from '@mui/material';
import { cn } from '@ds/utils';
import type { ModalContentProps } from './modal.types';

/**
 * ModalContent Component
 * 
 * Reusable modal content wrapper with consistent padding.
 * 
 * @example
 * ```tsx
 * <ModalContent>
 *   <Typography>Content here...</Typography>
 * </ModalContent>
 * ```
 */
export const ModalContent = forwardRef<HTMLDivElement, ModalContentProps>(
  function ModalContent(
    {
      children,
      disablePadding = false,
      className,
    },
    ref
  ) {
    return (
      <DialogContent
        ref={ref}
        className={cn('modal-content', className)}
        sx={{
          pt: disablePadding ? 0 : 2,
          pb: disablePadding ? 0 : 2,
          px: disablePadding ? 0 : 3,
          color: 'var(--theme-text-muted, var(--text-secondary, #4a4a4a))',
        }}
      >
        {children}
      </DialogContent>
    );
  }
);
