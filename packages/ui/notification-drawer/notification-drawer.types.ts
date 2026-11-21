import type { HTMLAttributes } from 'react';
import type { DrawerProps as MuiDrawerProps } from '@mui/material/Drawer';

export interface Notification {
  id: string;
  // 'ai' = server ADR-402 D12 rows (credit/MCP entitlement events);
  // 'offer' also carries ADR-397 bounty rows (meta.bountyTitle).
  type: 'ticket' | 'message' | 'system' | 'offer' | 'cooperation' | 'ai';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  archived?: boolean;
  relatedId?: string;
  actionUrl?: string;
  meta?: {
    offerTitle?: string;
    statusFrom?: string;
    statusTo?: string;
    partnerPubkey?: string;
    amountSats?: number;
    // initiator/partner = cooperation rows (server role naming), buyer/seller = tickets.
    role?: 'buyer' | 'seller' | 'initiator' | 'partner';
    event?: string;
    bountyTitle?: string;
    arbiterPubkey?: string;
    reasoning?: string;
    outcome?: string;
    workspaceId?: string;
    ticketId?: string;
    ticketType?: string;
    offerType?: 'SERVICE' | 'PRODUCT' | 'ITEM' | 'AGENT_SETUP';
    buyerPubkey?: string;
    sellerPubkey?: string;
    escrowStatus?: string;
    createdAt?: string;
    updatedAt?: string;
    milestoneId?: string;
    milestoneTitle?: string;
    milestoneIndex?: number;
    cooperationId?: string;
    cooperationType?: string;
    budgetSats?: number;
  };
}

export type NotificationFilter = 'all' | 'unread' | 'read' | 'archived';

export interface NotificationGroup {
  key: string;
  offerTitle: string | undefined;
  relatedId: string | undefined;
  actionUrl: string | undefined;
  notifications: Notification[];
  latestTimestamp: Date;
  hasUnread: boolean;
}

export interface NotificationDrawerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /**
   * Controls whether the drawer is open or closed
   */
  open: boolean;

  /**
   * Callback fired when the drawer is requested to be closed
   */
  onClose: () => void;

  /**
   * Array of notifications to display
   */
  notifications: Notification[];

  /**
   * Callback fired when a notification is marked as read
   */
  onMarkAsRead?: (id: string) => void;

  /**
   * Callback fired when all notifications are marked as read
   */
  onMarkAllAsRead?: () => void;

  /**
   * Callback fired when a single notification is removed
   */
  onRemove?: (id: string) => void;

  /**
   * Callback fired when all notifications are cleared / archived
   */
  onClearAll?: () => void;

  /**
   * Callback fired when a standalone notification is archived
   */
  onArchive?: (id: string) => void;

  /**
   * Callback fired when an entire ticket group is archived by relatedId
   */
  onArchiveGroup?: (relatedId: string) => void;

  /**
   * ADR-411: SPA navigation for a notification's actionUrl (react-router
   * navigate from the host app). When absent, only relative app paths are
   * followed via a full navigation; absolute/external URLs are ignored.
   */
  onNavigate?: (actionUrl: string) => void;

  /**
   * Optional custom width for the drawer (default: 400px desktop, 100% mobile)
   */
  width?: number | string;

  /**
   * Optional custom title for the drawer header
   */
  title?: string;

  /**
   * Callback fired when the "View All" footer button is clicked
   */
  onViewAll?: () => void;

  /**
   * Additional MUI Drawer props
   */
  drawerProps?: Partial<MuiDrawerProps>;
}