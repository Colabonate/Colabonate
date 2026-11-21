import { forwardRef } from 'react';
import { Box, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { ModalHeaderProps } from './modal.types';

/**
 * ModalHeader Component
 * 
 * Reusable modal header with title, optional subtitle, and close button.
 * Can be used inside custom Modal implementations or standalone.
 * 
 * @example
 * ```tsx
 * <Modal open={open} onClose={onClose}>
 *   <ModalHeader 
 *     title="Dialog Title" 
 *     subtitle="Optional subtitle"
 *     onClose={handleClose} 
 *   />
 *   <ModalContent>...</ModalContent>
 * </Modal>
 * ```
 */
export const ModalHeader = forwardRef<HTMLDivElement, ModalHeaderProps>(
  function ModalHeader(
    {
      title,
      subtitle,
      onClose,
      hideCloseButton = false,
      actions,
      titleVariant = 'h6',
    },
    ref
  ) {
    return (
      <DialogTitle
        ref={ref}
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 2,
          pb: 2,
          pr: 1,
          color: 'var(--theme-text, var(--text-primary, #1a1a1a))',
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, flex: 1, minWidth: 0 }}>
          {typeof title === 'string' ? (
            <Typography
              variant={titleVariant}
              fontWeight={700}
              sx={{
                lineHeight: 1.3,
                wordBreak: 'break-word',
              }}
            >
              {title}
            </Typography>
          ) : (
            title
          )}
          {subtitle && (
            typeof subtitle === 'string' ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ lineHeight: 1.5 }}
              >
                {subtitle}
              </Typography>
            ) : (
              subtitle
            )
          )}
          {actions && (
            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
              {actions}
            </Box>
          )}
        </Box>
        {!hideCloseButton && onClose && (
          <IconButton
            size="small"
            onClick={onClose}
            sx={{
              flexShrink: 0,
              color: 'var(--theme-text-muted, var(--text-secondary, #666))',
              '&:hover': {
                color: 'var(--theme-text, var(--text-primary, #1a1a1a))',
                bgcolor: 'var(--theme-item-hover, rgba(0,0,0,0.05))',
              },
            }}
          >
            <CloseIcon />
          </IconButton>
        )}
      </DialogTitle>
    );
  }
);
