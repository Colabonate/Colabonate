import type { ReactNode } from 'react';
import type { DialogProps } from '@mui/material';

/**
 * Modal Size Options
 * Defines the maximum width of the modal dialog
 */
export type ModalSize = 'sm' | 'md' | 'lg' | 'full';

/**
 * Modal Props
 * Extended from MUI DialogProps with simplified API
 */
export interface ModalProps extends Omit<DialogProps, 'title'> {
  /** Modal visibility state */
  open: boolean;
  
  /** Callback when modal should be closed */
  onClose: () => void;
  
  /** Modal title (renders in ModalHeader) */
  title?: ReactNode;
  
  /** Modal content */
  children: ReactNode;
  
  /** Optional actions (renders in ModalActions) */
  actions?: ReactNode;
  
  /** Modal size preset */
  size?: ModalSize;
  
  /** Enable blurry backdrop with radial gradient */
  blurryBackdrop?: boolean;
  
  /** Disable escape key to close */
  disableEscapeKeyDown?: boolean;
  
  /** Disable backdrop click to close */
  disableBackdropClick?: boolean;
}

/**
 * ModalHeader Props
 */
export interface ModalHeaderProps {
  /** Header title */
  title: ReactNode;
  
  /** Optional subtitle */
  subtitle?: ReactNode;
  
  /** Callback when close button is clicked */
  onClose?: () => void;
  
  /** Hide close button */
  hideCloseButton?: boolean;
  
  /** Additional actions in header (left side) */
  actions?: ReactNode;

  /** Title typography variant (default: 'h6') */
  titleVariant?: 'h5' | 'h6';
}

/**
 * ModalActions Props
 */
export interface ModalActionsProps {
  /** Cancel button configuration */
  cancel?: {
    onClick: () => void;
    children?: ReactNode;
    disabled?: boolean;
    hidden?: boolean;
  };
  
  /** Confirm button configuration */
  confirm?: {
    onClick: () => void;
    children?: ReactNode;
    disabled?: boolean;
    hidden?: boolean;
    loading?: boolean;
    color?: 'primary' | 'success' | 'error' | 'warning';
    startIcon?: ReactNode;
  };
  
  /** Additional custom actions */
  children?: ReactNode;
  
  /** Align actions (default: 'right') */
  align?: 'left' | 'center' | 'right' | 'space-between';
}

/**
 * ModalContent Props
 */
export interface ModalContentProps {
  /** Content children */
  children: ReactNode;
  
  /** Remove default padding */
  disablePadding?: boolean;
  
  /** Custom className */
  className?: string;
}

/**
 * useModal Hook Return Type
 */
export interface UseModalReturn {
  /** Open a modal with config */
  openModal: (config: ModalConfig) => void;
  
  /** Close the currently open modal */
  closeModal: () => void;
  
  /** Currently open modal config */
  currentModal: ModalConfig | null;
  
  /** Whether a modal is currently open */
  isOpen: boolean;
}

/**
 * Modal Configuration for useModal Hook
 */
export interface ModalConfig {
  /** Modal title */
  title: ReactNode;
  
  /** Modal content */
  content: ReactNode;
  
  /** Optional actions */
  actions?: {
    cancel?: {
      onClick?: () => void;
      children?: ReactNode;
      hidden?: boolean;
    };
    confirm?: {
      onClick?: () => void;
      children?: ReactNode;
      loading?: boolean;
      color?: 'primary' | 'success' | 'error' | 'warning';
      hidden?: boolean;
    };
  };
  
  /** Modal size */
  size?: ModalSize;
  
  /** Callback when modal is closed */
  onClose?: () => void;
  
  /** Disable escape key */
  disableEscapeKeyDown?: boolean;
  
  /** Disable backdrop click */
  disableBackdropClick?: boolean;
}

/**
 * ModalProvider Props
 */
export interface ModalProviderProps {
  /** Child components */
  children: ReactNode;
}
