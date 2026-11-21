import { forwardRef, useState } from 'react';
import {
  Drawer,
  List,
  ListItem,
  IconButton,
  Typography,
  Box,
  Badge,
  Button,
  Chip,
  Tooltip,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications'
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import SettingsIcon from '@mui/icons-material/Settings'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloseIcon from '@mui/icons-material/Close'
import VisibilityIcon from '@mui/icons-material/Visibility'
import ArchiveIcon from '@mui/icons-material/Archive'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import BoltIcon from '@mui/icons-material/Bolt'
import NorthEastIcon from '@mui/icons-material/NorthEast'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import HandshakeIcon from '@mui/icons-material/Handshake'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import { cn } from '@ds/utils';
import type {
  Notification,
  NotificationDrawerProps,
  NotificationFilter,
  NotificationGroup,
} from './notification-drawer.types';

// ── Status configuration ──────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  PENDING:     'Pending',
  ACCEPTED:    'Accepted',
  PAID:        'Paid',
  IN_PROGRESS: 'In Progress',
  COMPLETED:   'Completed',
  DISPUTED:    'Disputed',
  CANCELLED:   'Cancelled',
};

type MuiChipColor = 'default' | 'info' | 'success' | 'error' | 'warning';

const STATUS_COLOR: Record<string, MuiChipColor> = {
  PENDING:     'default',
  ACCEPTED:    'info',
  PAID:        'info',
  IN_PROGRESS: 'info',
  COMPLETED:   'success',
  DISPUTED:    'error',
  CANCELLED:   'default',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const getNotificationIcon = (type: Notification['type']) => {
  switch (type) {
    case 'ticket': return <ConfirmationNumberIcon sx={{ fontSize: 15 }} />;
    case 'message': return <ChatBubbleOutlineIcon sx={{ fontSize: 15 }} />;
    case 'system': return <SettingsIcon sx={{ fontSize: 15 }} />;
    case 'offer': return <CheckCircleIcon sx={{ fontSize: 15 }} />;
    case 'cooperation': return <HandshakeIcon sx={{ fontSize: 15 }} />;
    case 'ai': return <AutoAwesomeIcon sx={{ fontSize: 15 }} />;
    default: return <NotificationsIcon sx={{ fontSize: 15 }} />;
  }
};

const formatTimeAgo = (timestamp: Date) => {
  const now = new Date();
  const diffMs = now.getTime() - timestamp.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return timestamp.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
};

// ── Grouping ──────────────────────────────────────────────────────────────────

function buildGroups(notifications: Notification[]): NotificationGroup[] {
  const map = new Map<string, Notification[]>();
  for (const n of notifications) {
    const key = n.relatedId ?? n.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  return Array.from(map.entries())
    .map(([key, notifs]) => {
      const sorted = [...notifs].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const latest = sorted[0];
      return {
        key,
        offerTitle: latest.meta?.offerTitle,
        relatedId: latest.relatedId ?? undefined,
        actionUrl: latest.actionUrl,
        notifications: sorted,
        latestTimestamp: latest.timestamp,
        hasUnread: notifs.some(n => !n.read),
      };
    })
    .sort((a, b) => b.latestTimestamp.getTime() - a.latestTimestamp.getTime());
}

// ── Navigation ────────────────────────────────────────────────────────────────

/**
 * ADR-411: SPA navigation when the host provides onNavigate (react-router),
 * else a guarded full navigation — only relative app paths, never an
 * absolute/external URL that could carry the user out of the app.
 */
function navigateToAction(actionUrl: string, onNavigate?: (actionUrl: string) => void): void {
  if (onNavigate) {
    onNavigate(actionUrl);
    return;
  }
  if (actionUrl.startsWith('/') && !actionUrl.startsWith('//')) {
    window.location.assign(actionUrl);
  }
}

// ── NotificationGroupCard ─────────────────────────────────────────────────────

function NotificationGroupCard({
  group,
  expanded,
  onToggleExpand,
  onMarkAsRead,
  onArchive,
  onArchiveGroup,
  onNavigate,
}: {
  group: NotificationGroup;
  expanded: boolean;
  onToggleExpand: () => void;
  onMarkAsRead?: (id: string) => void;
  onArchive?: (id: string) => void;
  onArchiveGroup?: (relatedId: string) => void;
  onNavigate?: (actionUrl: string) => void;
}) {
  const latest = group.notifications[0];
  const { meta } = latest;
  const isGrouped = group.notifications.length > 1;
  const displayTitle = group.offerTitle ?? latest.title;

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (group.relatedId && onArchiveGroup) {
      onArchiveGroup(group.relatedId);
    } else if (onArchive) {
      onArchive(latest.id);
    }
  };

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (group.hasUnread && onMarkAsRead) {
      group.notifications.forEach(n => { if (!n.read) onMarkAsRead(n.id); });
    }
    if (latest.actionUrl) navigateToAction(latest.actionUrl, onNavigate);
  };

  const handleCardClick = () => {
    if (isGrouped) {
      onToggleExpand();
    } else {
      if (!latest.read && onMarkAsRead) onMarkAsRead(latest.id);
      if (latest.actionUrl) navigateToAction(latest.actionUrl, onNavigate);
    }
  };

  return (
    <ListItem
      disablePadding
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        borderRadius: '12px',
        margin: '4px 8px',
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        border: '1px solid var(--theme-border-subtle)',
        bgcolor: group.hasUnread ? 'var(--theme-bg-elevated)' : 'var(--theme-bg-paper)',
        borderLeft: group.hasUnread ? '3px solid var(--color-primary-50)' : undefined,
        '&:hover': { 
          bgcolor: 'var(--theme-bg-elevated)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        },
        '&:active': {
          bgcolor: 'var(--theme-bg-subtle)',
          transform: 'scale(0.995)',
        },
      }}
    >
      {/* Main card body */}
      <Box
        sx={{
          px: 2,
          py: 1.75,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          cursor: 'inherit',
        }}
        onClick={handleCardClick}
      >
        {/* Row 1: icon + title + time */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box
            sx={{
              mt: 0.5,
              color: group.hasUnread ? 'var(--color-primary-50)' : 'var(--theme-text-muted)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: '8px',
              bgcolor: group.hasUnread ? 'rgba(232, 69, 65, 0.08)' : 'var(--theme-bg-hover)',
            }}
          >
            {getNotificationIcon(latest.type)}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="body1"
              sx={{
                fontWeight: group.hasUnread ? 600 : 400,
                color: 'var(--theme-text)',
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '0.875rem',
              }}
            >
              {displayTitle}
            </Typography>
            {isGrouped ? (
              <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem', mt: 0.25 }}>
                {group.notifications.length} updates
              </Typography>
            ) : (
              latest.message ? (
                // ADR-411: render the server's instructional message (it was
                // written per-recipient — e.g. "redeem the Cashu token").
                <Typography
                  variant="body2"
                  sx={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem', display: 'block', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {latest.message}
                </Typography>
              ) : (
                <Typography
                  variant="body2"
                  sx={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem', display: 'block', mt: 0.25 }}
                >
                  {latest.title}
                </Typography>
              )
            )}
          </Box>
          <Typography
            variant="body2"
            sx={{ color: 'var(--theme-text-muted)', flexShrink: 0, mt: 0.5, fontSize: '0.7rem' }}
          >
            {formatTimeAgo(group.latestTimestamp)}
          </Typography>
        </Box>

        {/* Row 2: latest status chips */}
        {(meta?.statusFrom || meta?.statusTo) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 4.5 }}>
            {meta.statusFrom && (
              <Chip
                label={STATUS_LABEL[meta.statusFrom] ?? meta.statusFrom}
                size="small"
                variant="outlined"
                color={STATUS_COLOR[meta.statusFrom] ?? 'default'}
                sx={{ fontSize: '0.7rem', height: 22, '& .MuiChip-label': { px: 0.875 } }}
              />
            )}
            {meta.statusFrom && meta.statusTo && (
              <ArrowForwardIcon sx={{ fontSize: 12, color: 'var(--theme-text-muted)', flexShrink: 0 }} />
            )}
            {meta.statusTo && (
              <Chip
                label={STATUS_LABEL[meta.statusTo] ?? meta.statusTo}
                size="small"
                color={STATUS_COLOR[meta.statusTo] ?? 'default'}
                sx={{ fontSize: '0.7rem', fontWeight: 600, height: 22, '& .MuiChip-label': { px: 0.875 } }}
              />
            )}
          </Box>
        )}

        {/* Row 3: amount + action buttons */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pl: 4.5, mt: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {meta?.amountSats != null && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <BoltIcon sx={{ fontSize: 14, color: 'var(--color-primary-50)' }} />
                <Typography
                  variant="body2"
                  sx={{ color: 'var(--color-primary-50)', fontWeight: 600, fontSize: '0.8rem' }}
                >
                  {meta.amountSats.toLocaleString()} sats
                </Typography>
              </Box>
            )}
          </Box>

          <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            {group.hasUnread && onMarkAsRead && !isGrouped && (
              <Tooltip title="Mark as read">
                <IconButton
                  onClick={e => { e.stopPropagation(); onMarkAsRead(latest.id); }}
                  sx={{ 
                    color: 'var(--theme-text-secondary)', 
                    bgcolor: 'var(--theme-bg-hover)',
                    border: '1px solid var(--theme-border-subtle)',
                    transition: 'all 0.15s ease',
                    '&:hover': { color: 'var(--color-primary-50)', bgcolor: 'rgba(232, 69, 65, 0.08)', borderColor: 'var(--color-primary-50)' },
                    '&:active': { transform: 'scale(0.95)' },
                    width: 32,
                    height: 32,
                  }}
                >
                  <VisibilityIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Archive">
              <IconButton
                onClick={handleArchive}
                sx={{ 
                  color: 'var(--theme-text-secondary)', 
                  bgcolor: 'var(--theme-bg-hover)',
                  border: '1px solid var(--theme-border-subtle)',
                  transition: 'all 0.15s ease',
                  '&:hover': { color: '#f59e0b', bgcolor: 'rgba(245, 158, 11, 0.08)', borderColor: '#f59e0b' },
                  '&:active': { transform: 'scale(0.95)' },
                  width: 32,
                  height: 32,
                }}
              >
                <ArchiveIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            {latest.actionUrl && (
              <Tooltip title="Open">
                <IconButton
                  onClick={handleNavigate}
                  sx={{ 
                    color: 'var(--theme-text-secondary)', 
                    bgcolor: 'var(--theme-bg-hover)',
                    border: '1px solid var(--theme-border-subtle)',
                    transition: 'all 0.15s ease',
                    '&:hover': { color: 'var(--color-primary-50)', bgcolor: 'rgba(232, 69, 65, 0.08)', borderColor: 'var(--color-primary-50)' },
                    '&:active': { transform: 'scale(0.95)' },
                    width: 32,
                    height: 32,
                  }}
                >
                  <NorthEastIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
            {isGrouped && (
              <Tooltip title={expanded ? 'Collapse' : 'Show history'}>
                <IconButton
                  onClick={e => { e.stopPropagation(); onToggleExpand(); }}
                  sx={{ 
                    color: 'var(--theme-text-secondary)', 
                    bgcolor: 'var(--theme-bg-hover)',
                    border: '1px solid var(--theme-border-subtle)',
                    transition: 'all 0.15s ease',
                    '&:hover': { color: 'var(--theme-text)', bgcolor: 'var(--theme-bg-subtle)', borderColor: 'var(--theme-border)' },
                    '&:active': { transform: 'scale(0.95)' },
                    width: 32,
                    height: 32,
                  }}
                >
                  {expanded ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>
      </Box>

      {/* Expanded timeline */}
      {isGrouped && expanded && (
        <Box sx={{ borderTop: '1px solid var(--theme-border-subtle)', px: 2.5, py: 1.5, bgcolor: 'var(--theme-bg-subtle)' }}>
          {group.notifications.map((n, idx) => (
            <Box
              key={n.id}
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.5,
                py: 0.75,
                opacity: idx > 0 ? 0.65 : 1,
                borderLeft: idx > 0 ? '2px solid var(--theme-border-subtle)' : 'none',
                pl: idx > 0 ? 1.5 : 0,
                ml: idx > 0 ? -1 : 0,
              }}
            >
              <Box
                sx={{
                  mt: 0.75,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  bgcolor: n.read ? 'var(--theme-border)' : 'var(--color-primary-50)',
                  boxShadow: n.read ? 'none' : '0 0 0 2px rgba(232, 69, 65, 0.2)',
                }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: idx === 0 ? 500 : 400, color: 'var(--theme-text)', display: 'block', fontSize: '0.8rem' }}
                >
                  {n.title}
                </Typography>
                {n.meta?.statusFrom && n.meta?.statusTo && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                    <Typography variant="body2" sx={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>
                      {STATUS_LABEL[n.meta.statusFrom] ?? n.meta.statusFrom}
                    </Typography>
                    <ArrowForwardIcon sx={{ fontSize: 10, color: 'var(--theme-text-muted)' }} />
                    <Typography variant="body2" sx={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>
                      {STATUS_LABEL[n.meta.statusTo] ?? n.meta.statusTo}
                    </Typography>
                  </Box>
                )}
              </Box>
              <Typography variant="body2" sx={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)', flexShrink: 0, mt: 0.5 }}>
                {formatTimeAgo(n.timestamp)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </ListItem>
  );
}

// ── NotificationDrawer ───────────────────────────────────────────────────────

export const NotificationDrawer = forwardRef<HTMLDivElement, NotificationDrawerProps>(
  (
    {
      open,
      onClose,
      notifications,
      onMarkAsRead,
      onMarkAllAsRead,
      onRemove,
      onClearAll,
      onArchive,
      onArchiveGroup,
      onNavigate,
      onViewAll,
      width = 480,
      title = 'Notifications',
      drawerProps,
      className,
      ...props
    },
    ref
  ) => {
    const [filter, setFilter] = useState<NotificationFilter>('all');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    const toggleGroup = (key: string) => {
      setExpandedGroups(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    };

    const activeNotifs = notifications.filter(n => !n.archived);
    const archivedNotifs = notifications.filter(n => n.archived);
    const unreadCount = activeNotifs.filter(n => !n.read).length;
    const archivedCount = archivedNotifs.length;

    const filteredGroups = (() => {
      if (filter === 'archived') return buildGroups(archivedNotifs);
      const groups = buildGroups(activeNotifs);
      if (filter === 'unread') return groups.filter(g => g.hasUnread);
      if (filter === 'read') return groups.filter(g => !g.hasUnread);
      return groups;
    })();

    const filterChips: { key: NotificationFilter; label: string }[] = [
      { key: 'all',      label: `All (${activeNotifs.length})` },
      { key: 'unread',   label: `Unread (${unreadCount})` },
      { key: 'read',     label: `Read (${activeNotifs.length - unreadCount})` },
      { key: 'archived', label: `Archived (${archivedCount})` },
    ];

    return (
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        {...drawerProps}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: typeof width === 'number' ? `${width}px` : width },
            bgcolor: 'var(--theme-scrolled-bg)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: 'var(--theme-text)',
            borderLeft: '1px solid var(--theme-border)',
            borderRadius: '16px 0 0 16px',
            boxShadow: 'var(--theme-shadow), inset 0 0 0 1px var(--theme-border)',
            ...drawerProps?.sx,
          },
        }}
      >
        <Box
          ref={ref}
          className={cn('notification-drawer', className)}
          {...props}
          sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}
        >
          {/* Header */}
          <Box
            sx={{
              p: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--theme-border)',
              bgcolor: 'var(--theme-bg-subtle)',
            }}
          >
            <Typography
              variant="h6"
              sx={{ fontWeight: 600, color: 'var(--theme-text)', display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <NotificationsIcon sx={{ fontSize: 20 }} />
              {title}
              {unreadCount > 0 && (
                <Badge
                  badgeContent={unreadCount}
                  color="primary"
                  sx={{
                    '& .MuiBadge-badge': {
                      bgcolor: 'var(--color-primary-50)',
                      color: 'var(--color-neutral-white)',
                      fontSize: '0.75rem',
                      height: 18,
                      minWidth: 18,
                      borderRadius: '50%',
                    },
                  }}
                />
              )}
            </Typography>

            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              {onViewAll && (
                <Button
                  size="small"
                  variant="outlined"
                  endIcon={<NorthEastIcon sx={{ fontSize: 14 }} />}
                  onClick={onViewAll}
                  sx={{
                    borderColor: 'var(--theme-border)',
                    color: 'var(--theme-text)',
                    textTransform: 'none',
                    fontWeight: 500,
                    '&:hover': {
                      borderColor: 'var(--color-primary-50)',
                      color: 'var(--color-primary-50)',
                      bgcolor: 'transparent',
                    },
                  }}
                >
                  Overview
                </Button>
              )}
              {unreadCount > 0 && (
                <Tooltip title="Mark all as read">
                  <Button
                    size="small"
                    onClick={onMarkAllAsRead}
                    startIcon={<VisibilityIcon sx={{ fontSize: 14 }} />}
                    sx={{
                      fontSize: '0.8125rem',
                      px: 1.5,
                      py: 0.5,
                      bgcolor: 'var(--color-secondary-10)',
                      color: 'var(--color-secondary-70)',
                      '&:hover': { bgcolor: 'var(--color-secondary-20)' },
                    }}
                  >
                    Read all
                  </Button>
                </Tooltip>
              )}
              {activeNotifs.length > 0 && onClearAll && (
                <Tooltip title="Archive all">
                  <IconButton
                    size="small"
                    onClick={onClearAll}
                    sx={{
                      color: 'var(--theme-text-muted)',
                      '&:hover': { color: 'var(--color-warning-50, #f59e0b)', bgcolor: 'var(--theme-bg-hover)' },
                    }}
                  >
                    <ArchiveIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              )}
              <IconButton
                onClick={onClose}
                size="small"
                sx={{ color: 'var(--theme-text-muted)', '&:hover': { bgcolor: 'var(--theme-bg-hover)', color: 'var(--theme-text)' } }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          </Box>

          {/* Filter Chips */}
          <Box
            sx={{
              px: 2,
              py: 1,
              display: 'flex',
              gap: 0.75,
              flexWrap: 'wrap',
              borderBottom: '1px solid var(--theme-border-subtle)',
              bgcolor: 'var(--theme-bg-subtle)',
            }}
          >
            {filterChips.map(({ key, label }) => (
              <Chip
                key={key}
                label={label}
                size="small"
                onClick={() => setFilter(key)}
                sx={{
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  height: 24,
                  bgcolor: filter === key ? 'var(--color-primary-50)' : 'transparent',
                  color: filter === key ? 'white' : 'var(--theme-text-muted)',
                  border: filter !== key ? '1px solid var(--theme-border)' : 'none',
                  '&:hover': {
                    bgcolor: filter === key ? 'var(--color-primary-60)' : 'var(--theme-bg-hover)',
                  },
                }}
              />
            ))}
          </Box>

          {/* List */}
          <Box sx={{ 
            flex: 1, 
            overflowY: 'auto',
            overflowX: 'hidden',
            pr: 1,
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--theme-border) transparent',
            '&::-webkit-scrollbar': { width: 6 },
            '&::-webkit-scrollbar-thumb': { 
              background: 'var(--theme-border)', 
              borderRadius: 3,
              border: '2px solid transparent',
              backgroundClip: 'padding-box',
            },
            '&::-webkit-scrollbar-track': { 
              background: 'transparent',
            },
          }}>
            {filteredGroups.length === 0 ? (
              <Box sx={{ p: 5, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
                <Box sx={{ 
                  width: 64, 
                  height: 64, 
                  borderRadius: '16px', 
                  bgcolor: 'var(--theme-bg-hover)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  mx: 'auto',
                  mb: 2,
                }}>
                  <NotificationsIcon sx={{ fontSize: 28, opacity: 0.4 }} />
                </Box>
                <Typography variant="body1" sx={{ fontWeight: 500, color: 'var(--theme-text-secondary)' }}>
                  {filter === 'unread'
                    ? 'No unread notifications'
                    : filter === 'read'
                    ? 'No read notifications'
                    : filter === 'archived'
                    ? 'No archived notifications'
                    : 'No notifications'}
                </Typography>
              </Box>
            ) : (
              <List disablePadding>
                {filteredGroups.map(group => (
                  <NotificationGroupCard
                    key={group.key}
                    group={group}
                    expanded={expandedGroups.has(group.key)}
                    onToggleExpand={() => toggleGroup(group.key)}
                    onMarkAsRead={onMarkAsRead}
                    onArchive={onArchive ?? onRemove}
                    onArchiveGroup={onArchiveGroup}
                    onNavigate={onNavigate}
                  />
                ))}
              </List>
            )}
          </Box>
        </Box>
      </Drawer>
    );
  }
);

NotificationDrawer.displayName = 'NotificationDrawer';
