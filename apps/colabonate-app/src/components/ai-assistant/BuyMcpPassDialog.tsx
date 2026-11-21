// ADR-384 D11: the "get an MCP pass" dialog for /ai/connect (same Modal look as
// the AI credits dialog). ADR-410: single lifetime pass at the lowest price.
import { Modal, ModalContent } from '@ds/ui';
import { McpPassesPanel, type McpPassTier } from './McpPassesPanel';

interface Props {
  open: boolean;
  tiers: McpPassTier[];
  onClose: () => void;
  onPurchased: () => void;
  autoBuyTierId?: string | null;
  lifetimeActive?: boolean;
}

export function BuyMcpPassDialog({ open, tiers, onClose, onPurchased, autoBuyTierId, lifetimeActive }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Get lifetime MCP access" size="md" style={{ zIndex: 1400 }}>
      <ModalContent>
        <McpPassesPanel
          tiers={tiers}
          autoBuyTierId={autoBuyTierId ?? undefined}
          onPurchased={onPurchased}
          onClose={onClose}
          lifetimeActive={lifetimeActive}
        />
      </ModalContent>
    </Modal>
  );
}
