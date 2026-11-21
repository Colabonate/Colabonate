import { createContext, useContext, useState, type ReactNode } from 'react';
import { Modal, ModalActions, ModalContent } from '@ds/ui';
import type { ModalConfig, UseModalReturn } from '@ds/ui';

/**
 * Modal Context
 * Provides global modal state and control functions
 */
const ModalContext = createContext<UseModalReturn | undefined>(undefined);

/**
 * ModalProvider Component
 * 
 * Wraps the application with modal context and provides
 * a global modal instance for hook-based usage.
 * 
 * @example
 * ```tsx
 * // In App.tsx
 * <ModalProvider>
 *   <App />
 * </ModalProvider>
 * 
 * // In any component
 * const { openModal, closeModal } = useModal();
 * openModal({ title: 'Hello', content: <div>World</div> });
 * ```
 */
export function ModalProvider({ children }: { children: ReactNode }) {
  const [currentModal, setCurrentModal] = useState<ModalConfig | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const openModal = (config: ModalConfig) => {
    setCurrentModal(config);
    setIsOpen(true);
  };

  const closeModal = () => {
    // Call onClose callback if provided
    currentModal?.onClose?.();
    setCurrentModal(null);
    setIsOpen(false);
  };

  const handleConfirm = () => {
    currentModal?.actions?.confirm?.onClick?.();
  };

  const handleCancel = () => {
    currentModal?.actions?.cancel?.onClick?.();
    closeModal();
  };

  const value: UseModalReturn = {
    openModal,
    closeModal,
    currentModal,
    isOpen,
  };

  return (
    <ModalContext.Provider value={value}>
      {children}
      
      {/* Global Modal Instance */}
      {currentModal && (
        <Modal
          open={isOpen}
          onClose={closeModal}
          title={currentModal.title}
          size={currentModal.size}
          disableEscapeKeyDown={currentModal.disableEscapeKeyDown}
          disableBackdropClick={currentModal.disableBackdropClick}
          actions={currentModal.actions ? (
            <ModalActions
              cancel={
                currentModal.actions.cancel?.hidden
                  ? undefined
                  : {
                      onClick: handleCancel,
                      children: currentModal.actions.cancel?.children,
                    }
              }
              confirm={
                currentModal.actions.confirm?.hidden
                  ? undefined
                  : {
                      onClick: () => {
                        handleConfirm();
                        if (!currentModal.actions?.confirm?.loading) {
                          closeModal();
                        }
                      },
                      children: currentModal.actions.confirm?.children,
                      loading: currentModal.actions.confirm?.loading,
                      color: currentModal.actions.confirm?.color,
                    }
              }
            />
          ) : undefined}
        >
          <ModalContent>
            {currentModal.content}
          </ModalContent>
        </Modal>
      )}
    </ModalContext.Provider>
  );
}

/**
 * useModal Hook
 * 
 * Access global modal state and control functions.
 * Must be used within a ModalProvider.
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { openModal, closeModal } = useModal();
 * 
 *   const handleDelete = () => {
 *     openModal({
 *       title: 'Löschen bestätigen',
 *       content: <Typography>Möchten Sie dieses Element wirklich löschen?</Typography>,
 *       actions: {
 *         confirm: { onClick: performDelete, color: 'error' }
 *       }
 *     });
 *   };
 * 
 *   return <Button onClick={handleDelete}>Löschen</Button>;
 * }
 * ```
 */
export function useModal(): UseModalReturn {
  const context = useContext(ModalContext);
  if (context === undefined) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
}
