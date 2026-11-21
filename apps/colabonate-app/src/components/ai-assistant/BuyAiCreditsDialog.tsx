// ADR-384 D5: the one "buy AI credits" dialog, reused by the Home section, the
// FAB panel and the /ai page. Same look as "Support Colabonate" (Modal + tier
// buttons). `autoBuyTierId` lets a splash-screen tier button start that purchase
// immediately instead of asking the user to pick it a second time.
import { useRef } from 'react';
import { Modal, ModalContent } from '@ds/ui';
import { AiCreditsPanel } from './AiCreditsPanel';
import { announceAiCredits, isAiGuest } from './useAiCredits';

interface Props {
  open: boolean;
  onClose: () => void;
  autoBuyTierId?: string | null;
}

export function BuyAiCreditsDialog({ open, onClose, autoBuyTierId }: Props) {
  const opening = useRef<number | null>(null);
  const latest = useRef<number | null>(null);

  // Remember the balance at open so closing can tell whether something was bought.
  if (open && opening.current === null) opening.current = latest.current;
  if (!open) opening.current = null;

  const handleClose = () => {
    const bought = latest.current !== null && (opening.current ?? 0) < latest.current;
    // They just bought hosted credits: make hosted mode the active one.
    if (bought && !isAiGuest()) localStorage.setItem('aiProvider', 'platform');
    if (latest.current !== null) announceAiCredits(latest.current);
    onClose();
  };

  return (
    // Above the FAB panel (z 1301), which the default Modal (z 1300) would sit under.
    <Modal open={open} onClose={handleClose} title="Get AI credits" size="md" style={{ zIndex: 1400 }}>
      <ModalContent>
        <AiCreditsPanel
          autoBuyTierId={autoBuyTierId ?? undefined}
          onClose={handleClose}
          onBalanceChange={(n) => {
            if (opening.current === null) opening.current = n;
            latest.current = n;
          }}
        />
      </ModalContent>
    </Modal>
  );
}
