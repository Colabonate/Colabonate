import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation, formatLocaleDate } from '../../contexts/LocaleContext';
import {
  Avatar,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Tooltip,
  Typography,
  IconButton,
} from '@mui/material';
import {
  Bell,
  CheckCircle,
  Eye,
  MessageCircle,
  Settings,
  TicketIcon,
  Archive,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Handshake,
  Sparkles,
} from 'lucide-react';
import BellIcon          from '@mui/icons-material/NotificationsOutlined';
import CheckAllIcon      from '@mui/icons-material/DoneAll';
import ArchiveIcon       from '@mui/icons-material/Archive';
import { PageContainer, ListHeader } from '@ds/ui';
import type { KPIItem, Notification, NotificationGroup } from '@ds/ui';
import { KPIStrip } from '../../components/kpi/KpiStrip';
import { OFFER_TYPE_LABELS } from '@ds/utils';
import { PageHeader }    from '../../components/PageHeader';
import { UserLink } from '../../components/user/UserLink';
import { useNotification, usePollingBar } from '../../context/NotificationContext';
import { apiCall } from '../../lib/api';
import { getEscrowReleasedPct } from '../../lib/escrow-utils';
import { usePageAnimation } from '../../hooks/usePageAnimation';
import { gsap } from 'gsap';

// ── Konstanten ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  PENDING:     'Pending',
  ACCEPTED:    'Accepted',
  PAID:        'Paid',
  IN_PROGRESS: 'In Progress',
  COMPLETED:   'Completed',
  DISPUTED:    'Disputed',
  CANCELLED:   'Cancelled',
};

const STATUS_COLOR: Record<string, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
  PENDING:     'default',
  ACCEPTED:    'info',
  PAID:        'info',
  IN_PROGRESS: 'info',
  COMPLETED:   'success',
  DISPUTED:    'error',
  CANCELLED:   'default',
};

type ReadFilter = 'all' | 'unread' | 'read' | 'archived';
type TypeFilter = 'all' | 'ticket' | 'offer' | 'message' | 'system' | 'ai';

const TYPE_TABS: TypeFilter[] = ['all', 'ticket', 'offer', 'message', 'system', 'ai'];

const typeLabel: Record<TypeFilter, string> = {
  all:     'All',
  ticket:  'Tickets',
  offer:   'Offers',
  message: 'Messages',
  system:  'System',
  ai:      'AI & MCP',
};

// ADR-411: initiator/partner = cooperation rows (server role naming).
const ROLE_LABELS: Record<string, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  initiator: 'Initiator',
  partner: 'Partner',
};

const TICKET_TYPE_LABEL: Record<string, string> = {
  SMART_ORDER: 'Smart Order',
  MILESTONE:   'Milestone',
  DISPUTE:     'Dispute',
  GOVERNANCE:  'Governance',
  VERIFICATION: 'Verification',
  ROYALTY:     'Royalty',
};

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

function formatTimeAgo(timestamp: Date): string {
  const diffMs   = Date.now() - timestamp.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHrs  = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHrs / 24);
  if (diffMins < 1)  return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs  < 24) return `${diffHrs}h ago`;
  if (diffDays <  7) return `${diffDays}d ago`;
  return formatLocaleDate(timestamp, { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTimestamp(ts?: string): string | null {
  if (!ts) return null;
  return formatLocaleDate(new Date(ts), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

type NextAction = { label: string; color: 'default' | 'info' | 'success' | 'warning' | 'error' } | null;

function getNextAction(statusTo?: string, role?: string, offerType?: string): NextAction {
  if (!statusTo || !role) return null;
  // ADR-411: cooperation rows carry initiator/partner roles — coop-appropriate
  // next actions instead of the ticket payment flow.
  if (role === 'initiator' || role === 'partner') {
    const isInitiator = role === 'initiator';
    if (statusTo === 'PENDING') return isInitiator ? { label: 'Awaiting partner', color: 'info' } : { label: 'Review & accept', color: 'warning' };
    if (statusTo === 'ACCEPTED') return isInitiator ? { label: 'Fund escrow', color: 'success' } : { label: 'Awaiting funding', color: 'info' };
    if (statusTo === 'PAID') return isInitiator ? { label: 'Track progress', color: 'info' } : { label: 'Deliver milestones', color: 'info' };
    if (statusTo === 'IN_PROGRESS') return isInitiator ? { label: 'Review milestones', color: 'info' } : { label: 'Deliver milestones', color: 'info' };
    return null;
  }
  const isService = offerType === 'SERVICE';
  if (statusTo === 'PENDING') {
    return isService
      ? (role === 'seller' ? { label: 'Review request', color: 'warning' } : { label: 'Awaiting approval', color: 'info' })
      : { label: 'Generate invoice', color: 'info' };
  }
  if (statusTo === 'ACCEPTED' || statusTo === 'IN_PROGRESS') {
    return role === 'buyer'
      ? { label: 'Pay & release', color: 'success' }
      : { label: 'Deliver work', color: 'info' };
  }
  if (statusTo === 'PAID') {
    return role === 'seller'
      ? { label: 'Deliver work', color: 'info' }
      : { label: 'Awaiting delivery', color: 'info' };
  }
  return null;
}

function getNotificationTypeIcon(type: string, size = 15) {
  switch (type) {
    case 'ticket': return <TicketIcon size={size} />;
    case 'message': return <MessageCircle size={size} />;
    case 'system': return <Settings size={size} />;
    case 'offer': return <CheckCircle size={size} />;
    case 'ai': return <Sparkles size={size} />;
    case 'cooperation': return <Handshake size={size} />;
    default: return <Bell size={size} />;
  }
}

// ── Grouping ─────────────────────────────────────────────────────────────────

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

// ── NotificationGroupCard ─────────────────────────────────────────────────────

type MetaRecord = Record<string, unknown>;

function metaStr(m: MetaRecord | undefined, key: string): string | undefined {
  return m?.[key] as string | undefined;
}
function metaNum(m: MetaRecord | undefined, key: string): number | undefined {
  return m?.[key] as number | undefined;
}

function NotificationGroupCard({
  group,
  expanded,
  onToggleExpand,
  onMarkAsRead,
  onArchive,
  onArchiveGroup,
  liveMeta,
}: {
  group: NotificationGroup;
  expanded: boolean;
  onToggleExpand: () => void;
  onMarkAsRead: (id: string) => void;
  onArchive: (id: string) => void;
  onArchiveGroup: (relatedId: string) => void;
  liveMeta?: MetaRecord;
}) {
  const navigate = useNavigate();
  const { formatNumber } = useTranslation();
  const latest = group.notifications[0];
  const { meta } = latest;
  const em: MetaRecord = liveMeta ?? (meta as MetaRecord) ?? {};
  const isGrouped = group.notifications.length > 1;
  const ticketId = metaStr(em, 'ticketId') ?? meta?.ticketId ?? latest.relatedId;
  const escrowPct = getEscrowReleasedPct(metaStr(em, 'escrowStatus'));
  const hasEscrow = !!metaStr(em, 'escrowStatus');
  const nextAction = getNextAction(
    metaStr(em, 'statusTo'),
    metaStr(em, 'role'),
    metaStr(em, 'offerType'),
  );
  const displayTitle = group.offerTitle ?? latest.title;

  const handleGroupArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (group.relatedId) onArchiveGroup(group.relatedId);
    else onArchive(latest.id);
  };

  const handleClick = () => {
    if (!latest.read) onMarkAsRead(latest.id);
    if (latest.actionUrl) navigate(latest.actionUrl);
  };

  interface DetailItem { label: string; value: string; mono?: boolean; pubkey?: string }
  const details: DetailItem[] = [];
  const createdAt = metaStr(em, 'createdAt');
  if (createdAt) details.push({ label: 'Created', value: formatTimestamp(createdAt) ?? '' });
  const updatedAt = metaStr(em, 'updatedAt');
  if (updatedAt) details.push({ label: 'Updated', value: formatTimestamp(updatedAt) ?? '' });
  const buyerPk = metaStr(em, 'buyerPubkey');
  if (buyerPk) details.push({ label: 'Buyer', value: buyerPk, mono: true, pubkey: buyerPk });
  const sellerPk = metaStr(em, 'sellerPubkey');
  if (sellerPk) details.push({ label: 'Seller', value: sellerPk, mono: true, pubkey: sellerPk });
  const offerType = metaStr(em, 'offerType');
  if (offerType) details.push({ label: 'Type', value: OFFER_TYPE_LABELS[offerType] ?? offerType });
  const ticketType = metaStr(em, 'ticketType');
  if (ticketType) details.push({ label: 'Ticket', value: TICKET_TYPE_LABEL[ticketType] ?? ticketType });
  const amountSats = metaNum(em, 'amountSats');
  if (amountSats != null) details.push({ label: 'Amount', value: `${formatNumber(amountSats)} sats` });
  const role = metaStr(em, 'role');
  if (role) details.push({ label: 'Your Role', value: ROLE_LABELS[role] ?? role });
  if (metaStr(em, 'escrowStatus')) details.push({ label: 'Escrow', value: `${escrowPct}% released` });

  const detailPairs: DetailItem[][] = [];
  for (let i = 0; i < details.length; i += 2) {
    detailPairs.push(details.slice(i, i + 2));
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        transition: 'box-shadow 0.2s, border-color 0.2s',
        '&:hover': { boxShadow: 3, borderColor: 'primary.main' },
        overflow: 'hidden',
        bgcolor: group.hasUnread ? 'action.hover' : undefined,
        borderLeft: group.hasUnread ? '3px solid var(--color-primary-50)' : undefined,
      }}
    >
      {/* Main clickable area */}
      <Box
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        sx={{ cursor: latest.actionUrl ? 'pointer' : 'default' }}
      >
        <Box sx={{ p: { xs: 2, md: 2.5 } }}>

          {/* ── Header row ── */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 26, height: 26, borderRadius: '6px', flexShrink: 0,
                  color: group.hasUnread ? 'var(--color-primary-50)' : 'var(--theme-text-muted)',
                  bgcolor: group.hasUnread ? 'rgba(232, 69, 65, 0.08)' : 'var(--theme-bg-hover)',
                }}
              >
                {getNotificationTypeIcon(latest.type, 13)}
              </Box>
              {ticketId && (
                <Chip
                  label={`#${String(ticketId).slice(0, 8)}`}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem', fontFamily: 'monospace', fontWeight: 600, height: 22 }}
                />
              )}
              <Chip
                label={typeLabel[latest.type as TypeFilter] ?? latest.type}
                size="small"
                variant="outlined"
                color="primary"
                sx={{ fontSize: '0.65rem', height: 22 }}
              />
              {metaStr(em, 'statusFrom') && (
                <Chip
                  label={STATUS_LABEL[metaStr(em, 'statusFrom')!] ?? metaStr(em, 'statusFrom')}
                  size="small"
                  variant="outlined"
                  color={STATUS_COLOR[metaStr(em, 'statusFrom')!] ?? 'default'}
                  sx={{ fontSize: '0.7rem' }}
                />
              )}
              {metaStr(em, 'statusFrom') && metaStr(em, 'statusTo') && (
                <ArrowRight size={12} style={{ opacity: 0.5 }} />
              )}
              {metaStr(em, 'statusTo') && (
                <Chip
                  label={STATUS_LABEL[metaStr(em, 'statusTo')!] ?? metaStr(em, 'statusTo')}
                  size="small"
                  color={STATUS_COLOR[metaStr(em, 'statusTo')!] ?? 'default'}
                  sx={{ fontSize: '0.7rem', fontWeight: 600 }}
                />
              )}
              {!metaStr(em, 'statusTo') && !metaStr(em, 'statusFrom') && (
                <Chip
                  label={typeLabel[latest.type as TypeFilter] ?? latest.type}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem' }}
                />
              )}
              {nextAction && (
                <Chip
                  label={nextAction.label}
                  color={nextAction.color}
                  size="small"
                  sx={{ fontSize: '0.7rem', fontWeight: 600 }}
                />
              )}
              {isGrouped && (
                <Chip
                  label={`${group.notifications.length} updates`}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.65rem', height: 22 }}
                />
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
              {group.hasUnread && (
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'var(--color-primary-50)' }} />
              )}
              <Tooltip title={latest.timestamp.toLocaleString()}>
                <Typography variant="caption" color="text.disabled">
                  {formatTimeAgo(latest.timestamp)}
                </Typography>
              </Tooltip>
            </Box>
          </Box>

          {/* ── Title row + Action buttons ── */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body1" fontWeight={group.hasUnread ? 700 : 500} color="text.primary" noWrap>
                {displayTitle}
              </Typography>
              {isGrouped && (
                <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.25 }}>
                  {latest.title}
                </Typography>
              )}
              {!isGrouped && latest.message && (
                // ADR-411: surface the server's per-recipient instructional message.
                <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.25 }}>
                  {latest.message}
                </Typography>
              )}
            </Box>
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}
              onClick={e => e.stopPropagation()}
            >
              {latest.actionUrl && (
                <Tooltip title="Open ticket">
                  <IconButton
                    onClick={() => {
                      if (!latest.read) onMarkAsRead(latest.id);
                      navigate(latest.actionUrl!);
                    }}
                    sx={{ border: '1px solid var(--theme-border)', borderRadius: 1.5 }}
                  >
                    <ExternalLink size={16} />
                  </IconButton>
                </Tooltip>
              )}
              {group.hasUnread && (
                <Tooltip title="Mark as read">
                  <IconButton
                    onClick={() => group.notifications.forEach(n => { if (!n.read) onMarkAsRead(n.id); })}
                    sx={{ border: '1px solid var(--theme-border)', borderRadius: 1.5 }}
                  >
                    <Eye size={16} />
                  </IconButton>
                </Tooltip>
              )}
              {isGrouped && (
                <Tooltip title={expanded ? 'Collapse history' : 'Show history'}>
                  <IconButton
                    onClick={onToggleExpand}
                    sx={{ border: '1px solid var(--theme-border)', borderRadius: 1.5 }}
                  >
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={isGrouped ? 'Archive group' : 'Archive'}>
                <IconButton
                  onClick={handleGroupArchive}
                  sx={{ border: '1px solid var(--theme-border)', borderRadius: 1.5 }}
                >
                  <Archive size={16} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* ── Detail columns ── */}
          {detailPairs.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, mt: 1.5, minWidth: 0, overflow: 'auto' }}>
              {detailPairs.map((pair, colIdx) => (
                <Box
                  key={colIdx}
                  sx={{ flex: '1 1 0', minWidth: 140, display: 'flex', flexDirection: 'column', gap: 1 }}
                >
                  {pair.map(({ label, value, mono, pubkey }) => (
                    <Paper key={label} variant="outlined" sx={{ p: 1.5, borderRadius: 2, flex: 1 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={500} display="block" mb={0.5}>
                        {label}
                      </Typography>
                      {pubkey ? (
                        <UserLink pubkey={pubkey} size="small" />
                      ) : (
                        <Typography
                          variant="body2"
                          fontWeight={600}
                          fontFamily={mono ? 'monospace' : undefined}
                          color={mono ? 'text.secondary' : 'text.primary'}
                          sx={{ wordBreak: 'break-all', fontSize: mono ? '0.72rem' : '0.85rem' }}
                        >
                          {value}
                        </Typography>
                      )}
                    </Paper>
                  ))}
                </Box>
              ))}
            </Box>
          )}

          {/* ── Escrow progress bar ── */}
          {hasEscrow && metaNum(em, 'amountSats') != null && (
            <Box sx={{ mt: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ShieldCheck size={13} style={{ color: escrowPct >= 100 ? 'var(--color-success-50)' : 'var(--color-primary-50)' }} />
                  <Typography variant="caption" fontWeight={600} color="text.secondary">
                    Escrow progress
                  </Typography>
                </Box>
                <Typography variant="caption" fontWeight={600} color={escrowPct >= 100 ? 'success.main' : 'text.secondary'}>
                  {escrowPct}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={escrowPct}
                color={escrowPct >= 100 ? 'success' : 'primary'}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          )}
        </Box>
      </Box>

      {/* ── Expanded timeline ── */}
      {isGrouped && expanded && (
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: { xs: 2, md: 2.5 }, py: 1.5 }}>
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 1, fontWeight: 600 }}>
            Update history
          </Typography>
          {group.notifications.map((n, idx) => (
            <Box
              key={n.id}
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                py: 0.75,
                opacity: idx > 0 ? 0.75 : 1,
                borderBottom: idx < group.notifications.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
              }}
            >
              <Box
                sx={{
                  mt: 0.25,
                  width: 20,
                  height: 20,
                  borderRadius: '4px',
                  flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: n.read ? 'var(--theme-text-muted)' : 'var(--color-primary-50)',
                  bgcolor: n.read ? 'var(--theme-bg-hover)' : 'rgba(232, 69, 65, 0.08)',
                }}
              >
                {getNotificationTypeIcon(n.type, 11)}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={idx === 0 ? 600 : 400} noWrap>
                  {n.title}
                </Typography>
                {n.meta?.statusFrom && n.meta?.statusTo && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                    <Chip
                      label={STATUS_LABEL[n.meta.statusFrom] ?? n.meta.statusFrom}
                      size="small"
                      variant="outlined"
                      color={STATUS_COLOR[n.meta.statusFrom] ?? 'default'}
                      sx={{ fontSize: '0.6rem', height: 18, '& .MuiChip-label': { px: 0.5 } }}
                    />
                    <ArrowRight size={10} style={{ opacity: 0.5 }} />
                    <Chip
                      label={STATUS_LABEL[n.meta.statusTo] ?? n.meta.statusTo}
                      size="small"
                      color={STATUS_COLOR[n.meta.statusTo] ?? 'default'}
                      sx={{ fontSize: '0.6rem', height: 18, fontWeight: 600, '& .MuiChip-label': { px: 0.5 } }}
                    />
                  </Box>
                )}
              </Box>
              <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
                {formatTimeAgo(n.timestamp)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}

// ── Notifications Page ────────────────────────────────────────────────────────

export function Notifications() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { pollTick } = usePollingBar();
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearAllNotifications,
    archiveNotification,
    archiveNotificationGroup,
  } = useNotification();

  const [readFilter,  setReadFilter]  = useState<ReadFilter>('all');
  const [typeFilter,  setTypeFilter]  = useState<TypeFilter>('all');
  const [sortBy,      setSortBy]      = useState<'newest' | 'oldest'>('newest');
  const [metaSnapshot, setMetaSnapshot] = useState<Map<string, Record<string, unknown>>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);

  const pageRef = usePageAnimation([
    { selector: '.page-animate', from: { duration: 0.5, stagger: 0.1, y: 20 } },
  ]);

  const refreshMeta = useCallback(async () => {
    const pubkey = localStorage.getItem('pubkey');
    if (!pubkey) return;

    try {
      const [ticketRes, coopRes] = await Promise.all([
        apiCall(`/api/tickets?pubkey=${pubkey}`),
        apiCall(`/api/cooperations?pubkey=${pubkey}`),
      ]);
      const ticketData = await ticketRes.json();
      const coopData = await coopRes.json();

      const snapshot = new Map<string, Record<string, unknown>>();

      for (const t of (ticketData.tickets ?? [])) {
        snapshot.set(t.id, {
          status: t.status,
          escrowStatus: t.escrowStatus,
          updatedAt: t.updatedAt,
          amountSats: t.amountSats ?? t.offer?.priceSats,
          milestones: t.milestones,
        });
      }

      for (const c of (coopData.cooperations ?? [])) {
        snapshot.set(c.id, {
          status: c.status,
          partnerPubkey: c.partnerPubkey,
          updatedAt: c.updatedAt,
          budgetSats: c.budgetSats,
          milestones: c.milestones,
        });
      }

      setMetaSnapshot(snapshot);
    } catch {
      // silent — don't disrupt the UI
    }
  }, []);

  useEffect(() => {
    if (pollTick > 0) refreshMeta();
  }, [pollTick, refreshMeta]);

  // Pre-expand group from URL ?expand=<groupKey>
  const expandKeyFromUrl = searchParams.get('expand') ?? undefined;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() =>
    expandKeyFromUrl ? new Set([expandKeyFromUrl]) : new Set()
  );

  // Scroll to the pre-expanded group on mount
  const groupRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  useEffect(() => {
    if (!expandKeyFromUrl) return;
    const el = groupRefs.current.get(expandKeyFromUrl);
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    }
  }, [expandKeyFromUrl]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredGroups = useMemo(() => {
    let list = notifications;
    if (readFilter === 'archived') {
      const groups = buildGroups(list.filter(n => n.archived));
      return sortBy === 'oldest'
        ? [...groups].sort((a, b) => a.latestTimestamp.getTime() - b.latestTimestamp.getTime())
        : groups;
    }
    list = list.filter(n => !n.archived);
    if (readFilter === 'unread') list = list.filter(n => !n.read);
    if (readFilter === 'read')   list = list.filter(n =>  n.read);
    if (typeFilter !== 'all')    list = list.filter(n => n.type === typeFilter);
    const groups = buildGroups(list);
    return sortBy === 'oldest'
      ? [...groups].sort((a, b) => a.latestTimestamp.getTime() - b.latestTimestamp.getTime())
      : groups;
  }, [notifications, readFilter, typeFilter, sortBy]);

  useEffect(() => {
    if (expandKeyFromUrl || filteredGroups.length === 0) return;
    const firstKey = filteredGroups[0].key;
    setExpandedGroups(prev => {
      if (prev.size > 0) return prev;
      return new Set([firstKey]);
    });
  }, [expandKeyFromUrl, filteredGroups]);

  useEffect(() => {
    if (!listRef.current || filteredGroups.length === 0) return;
    const ctx = gsap.from('.notif-list-item', {
      y: 16,
      opacity: 0,
      duration: 0.35,
      stagger: 0.05,
      ease: 'power2.out',
      clearProps: 'opacity,transform',
    });
    return () => { ctx.revert(); };
  }, [filteredGroups.length, readFilter, typeFilter, sortBy]);

  const activeNotifs = notifications.filter(n => !n.archived);
  const archivedCount = notifications.filter(n => n.archived).length;

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: activeNotifs.length };
    for (const n of activeNotifs) c[n.type] = (c[n.type] ?? 0) + 1;
    return c;
  }, [activeNotifs]);

  const kpiItems = useMemo<KPIItem[]>(() => {
    let tickets = 0, offers = 0;
    for (const n of activeNotifs) {
      if (n.type === 'ticket') tickets++;
      if (n.type === 'offer') offers++;
    }
    return [
      { icon: <BellIcon sx={{ fontSize: 14 }} />, value: activeNotifs.length, label: 'Total', onClick: () => setReadFilter('all'), active: readFilter === 'all', heading: 'Overview' },
      { icon: <BellIcon sx={{ fontSize: 14 }} />, value: unreadCount, label: 'Unread', onClick: () => setReadFilter('unread'), active: readFilter === 'unread' },
      { icon: <TicketIcon size={14} />, value: tickets, label: 'Tickets', onClick: () => setTypeFilter('ticket'), active: typeFilter === 'ticket', heading: 'Types' },
      { icon: <CheckCircle size={14} />, value: offers, label: 'Offers', onClick: () => setTypeFilter('offer'), active: typeFilter === 'offer' },
      { icon: <MessageCircle size={14} />, value: typeCounts['message'] ?? 0, label: 'Messages', onClick: () => setTypeFilter('message'), active: typeFilter === 'message' },
      { icon: <Settings size={14} />, value: typeCounts['system'] ?? 0, label: 'System', onClick: () => setTypeFilter('system'), active: typeFilter === 'system' },
    ];
  }, [activeNotifs, unreadCount, readFilter, typeFilter, typeCounts]);

  return (
    <PageContainer size="wide" spacing="lg">
      <div ref={pageRef}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <Box className="page-animate" sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <PageHeader
          icon={<BellIcon fontSize="medium" />}
          title="Notifications"
          subtitle={`${activeNotifs.length} active · ${unreadCount} unread · ${archivedCount} archived`}
          onBack={() => navigate('/')}
        />
        <Box sx={{ display: 'flex', gap: 1, pt: 0.5 }}>
          {unreadCount > 0 && (
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckAllIcon sx={{ fontSize: 16 }} />}
              onClick={markAllAsRead}
              sx={{ bgcolor: 'var(--color-primary-50)', '&:hover': { bgcolor: 'var(--color-primary-60)' } }}
            >
              Read All
            </Button>
          )}
          {activeNotifs.length > 0 && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<ArchiveIcon sx={{ fontSize: 16 }} />}
              onClick={clearAllNotifications}
              sx={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}
            >
              Archive All
            </Button>
          )}
        </Box>
      </Box>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <KPIStrip className="page-animate" items={kpiItems} wrap collapsible storageKey="kpi-notifications-strip" />

      {/* ── ListHeader + Liste ─────────────────────────────────────────── */}
      <div className="page-animate" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <ListHeader
        tabs={TYPE_TABS.map(t => ({ key: t, label: typeLabel[t] }))}
        activeTab={typeFilter}
        onTabChange={key => setTypeFilter(key as TypeFilter)}
        actions={[
          {
            key: 'read-filter',
            element: (
              <select
                value={readFilter}
                onChange={e => setReadFilter(e.target.value as ReadFilter)}
                className="rounded-lg outline-none cursor-pointer"
                style={{
                  fontSize: 12,
                  height: 36,
                  padding: '0 10px',
                  background: 'var(--theme-bg-subtle)',
                  color: 'var(--theme-text-muted)',
                  border: '1px solid var(--theme-border)',
                  minWidth: 110,
                }}
              >
                <option value="all">{`All (${activeNotifs.length})`}</option>
                <option value="unread">{`Unread (${unreadCount})`}</option>
                <option value="read">{`Read (${activeNotifs.length - unreadCount})`}</option>
                <option value="archived">{`Archived (${archivedCount})`}</option>
              </select>
            ),
          },
          {
            key: 'sort',
            element: (
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as 'newest' | 'oldest')}
                className="rounded-lg outline-none cursor-pointer"
                style={{
                  fontSize: 12,
                  height: 36,
                  padding: '0 10px',
                  background: 'var(--theme-bg-subtle)',
                  color: 'var(--theme-text-muted)',
                  border: '1px solid var(--theme-border)',
                  minWidth: 100,
                }}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            ),
          },
        ]}
        mt={0}
      />

      {filteredGroups.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 10 }}>
          <Avatar sx={{ width: 64, height: 64, bgcolor: 'action.hover', mx: 'auto', mb: 2 }}>
            <Bell size={32} style={{ opacity: 0.4 }} />
          </Avatar>
          <Typography variant="h6" color="text.secondary">
            {readFilter === 'unread'
              ? 'No unread notifications'
              : readFilter === 'archived'
              ? 'No archived notifications'
              : typeFilter !== 'all'
              ? `No ${typeLabel[typeFilter]} notifications`
              : 'No notifications yet'}
          </Typography>
          {readFilter === 'all' && typeFilter === 'all' && (
            <Typography variant="body2" color="text.disabled" mt={0.5}>
              New ticket activities will appear here automatically.
            </Typography>
          )}
        </Box>
      ) : (
        <Box ref={listRef} sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {filteredGroups.map(group => (
            <div
              key={group.key}
              className="notif-list-item"
              ref={el => {
                if (el) groupRefs.current.set(group.key, el);
                else groupRefs.current.delete(group.key);
              }}
              style={{
                outline: expandKeyFromUrl === group.key ? '2px solid var(--color-primary-50)' : undefined,
                borderRadius: 8,
                transition: 'outline 0.4s ease',
              }}
            >
              <NotificationGroupCard
                group={group}
                expanded={expandedGroups.has(group.key)}
                onToggleExpand={() => toggleGroup(group.key)}
                onMarkAsRead={markAsRead}
                onArchive={archiveNotification}
                onArchiveGroup={archiveNotificationGroup}
                liveMeta={metaSnapshot.get(group.relatedId ?? group.key) as Record<string, unknown> | undefined}
              />
            </div>
          ))}
        </Box>
      )}
      </div>

      </div>
    </PageContainer>
  );
}
