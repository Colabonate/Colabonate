import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCircle, AlertTriangle, XCircle, X, ExternalLink, Undo2 } from 'lucide-react';
import { cn, useIsMobile } from '@ds/utils';
import { formatLocaleNumber } from '../contexts/LocaleContext';
import type { Notification } from '@ds/ui';
import type { TransientSnackbar } from '../context/NotificationContext';

// ── Types ────────────────────────────────────────────────────────────────────

type Severity = 'success' | 'info' | 'warning' | 'error';

type DisplayItem =
  | {
      kind: 'persistent';
      id: string;
      groupKey: string;
      title: string;
      detail: string;
      severity: Severity;
    }
  | {
      kind: 'transient';
      id: string;
      message: string;
      severity: Severity;
      undoLabel?: string;
      onUndo?: () => void;
      duration?: number;
    };

interface SnackbarManagerProps {
  notifications: Notification[];
  transientSnackbar: TransientSnackbar | null;
  onTransientConsumed: (id?: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  PENDING:     'Pending',
  ACCEPTED:    'Accepted',
  PAID:        'Paid',
  IN_PROGRESS: 'In Progress',
  COMPLETED:   'Completed',
  DISPUTED:    'Disputed',
  CANCELLED:   'Cancelled',
};

const SEVERITY_ICON: Record<Severity, React.ReactNode> = {
  success: <CheckCircle size={15} />,
  info:    <Bell size={15} />,
  warning: <AlertTriangle size={15} />,
  error:   <XCircle size={15} />,
};

const SEVERITY_ACCENT: Record<Severity, string> = {
  success: 'var(--color-success-50, #22c55e)',
  info:    'var(--color-primary-50, #6366f1)',
  warning: '#f59e0b',
  error:   'var(--color-error-50, #ef4444)',
};

const SEVERITY_ICON_BG: Record<Severity, string> = {
  success: 'rgba(34, 197, 94, 0.14)',
  info:    'rgba(99, 102, 241, 0.14)',
  warning: 'rgba(245, 158, 11, 0.14)',
  error:   'rgba(239, 68, 68, 0.14)',
};

function buildDetail(n: Notification): string {
  const { meta } = n;
  const parts: string[] = [];
  if (meta?.offerTitle) parts.push(meta.offerTitle);
  if (meta?.statusFrom && meta?.statusTo) {
    parts.push(`${STATUS_LABEL[meta.statusFrom] ?? meta.statusFrom} → ${STATUS_LABEL[meta.statusTo] ?? meta.statusTo}`);
  } else if (meta?.statusTo) {
    parts.push(STATUS_LABEL[meta.statusTo] ?? meta.statusTo);
  }
  if (meta?.amountSats != null) {
    parts.push(`⚡ ${formatLocaleNumber(meta.amountSats)} sats`);
  }
  if (meta?.partnerPubkey) {
    const pk = meta.partnerPubkey;
    parts.push(pk.length > 12 ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : pk);
  }
  return parts.length > 0 ? parts.join(' · ') : n.message;
}

function toPersistentItem(n: Notification): DisplayItem {
  return {
    kind: 'persistent',
    id: n.id,
    groupKey: (n.type === 'ticket' && n.relatedId) ? n.relatedId : n.id,
    title: n.title,
    detail: buildDetail(n),
    severity:
      n.type === 'offer'   ? 'success' :
      n.type === 'ticket'  ? 'info'    :
      n.type === 'message' ? 'info'    : 'warning',
  };
}

// ── Toast ─────────────────────────────────────────────────────────────────────

const DEFAULT_DURATION = 4500;

function Toast({
  item,
  duration,
  isMobile,
  onDismiss,
  onView,
}: {
  item: DisplayItem;
  duration: number;
  isMobile: boolean;
  onDismiss: () => void;
  onView?: () => void;
}) {
  const [phase, setPhase] = useState<'entering' | 'idle' | 'exiting'>('entering');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase('exiting');
  }, []);

  useEffect(() => {
    timerRef.current = setTimeout(dismiss, duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [duration, dismiss]);

  const handleAnimEnd = () => {
    if (phase === 'entering') setPhase('idle');
    else if (phase === 'exiting') onDismiss();
  };

  const severity = item.severity;
  const accent = SEVERITY_ACCENT[severity];
  const iconBg = SEVERITY_ICON_BG[severity];

  const hasUndo  = item.kind === 'transient' && !!item.undoLabel && typeof item.onUndo === 'function';
  const showView = item.kind === 'persistent' && !!onView;

  const handleUndo = () => {
    if (item.kind === 'transient' && item.onUndo) item.onUndo();
    dismiss();
  };

  const handleView = () => {
    onView?.();
    dismiss();
  };

  return (
    <div
      className={cn(
        phase === 'entering' && 'snackbar-entering',
        phase === 'exiting'  && 'snackbar-exiting',
      )}
      onAnimationEnd={handleAnimEnd}
      style={{
        backdropFilter: 'blur(20px) saturate(160%)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%)',
        background: 'var(--snackbar-bg)',
        border: '1px solid var(--snackbar-border)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 14,
        width: isMobile ? 'calc(100vw - 24px)' : 400,
        maxWidth: 400,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)',
        position: 'relative',
      }}
    >
      {/* Body */}
      <div style={{ padding: '13px 14px 10px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {/* Severity icon */}
        <div
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: 8,
            background: iconBg,
            color: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 1,
          }}
        >
          {SEVERITY_ICON[severity]}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {item.kind === 'persistent' ? (
            <>
              <p style={{
                margin: 0,
                fontSize: '0.9125rem',
                fontWeight: 600,
                lineHeight: 1.3,
                color: 'var(--snackbar-text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {item.title}
              </p>
              <p style={{
                margin: '2px 0 0',
                fontSize: '1.12rem',
                lineHeight: 1.4,
                color: 'var(--snackbar-muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {item.detail}
              </p>
            </>
          ) : (
            <p style={{
              margin: 0,
              fontSize: '0.9125rem',
              fontWeight: 600,
              lineHeight: 1.3,
              color: 'var(--snackbar-text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {item.message}
            </p>
          )}

          {/* Action buttons */}
          {(showView || hasUndo) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {showView && (
                <button
                  onClick={handleView}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 10px',
                    borderRadius: 6,
                    border: `1px solid ${accent}`,
                    background: 'transparent',
                    color: accent,
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 150ms, opacity 150ms',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = iconBg)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <ExternalLink size={11} />
                  View
                </button>
              )}
              {hasUndo && (
                <button
                  onClick={handleUndo}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--snackbar-border)',
                    background: 'transparent',
                    color: 'var(--snackbar-muted)',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'color 150ms, border-color 150ms',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--snackbar-text)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--snackbar-muted)'; }}
                >
                  <Undo2 size={11} />
                  {item.kind === 'transient' ? item.undoLabel : 'Undo'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={dismiss}
          aria-label="Close"
          style={{
            flexShrink: 0,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--snackbar-muted)',
            padding: 2,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 1,
            transition: 'color 150ms',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--snackbar-text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--snackbar-muted)')}
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 2,
          background: accent,
          transformOrigin: 'left',
          opacity: 0.5,
          animation: `snackbar-progress ${duration}ms linear forwards`,
        }}
      />
    </div>
  );
}

// ── SnackbarManager ────────────────────────────────────────────────────────────

const MAX_VISIBLE = 5;
const TOAST_STEP = 10; // height (68) + gap (8) — fixed step per stacked toast

export function SnackbarManager({ notifications, transientSnackbar, onTransientConsumed }: SnackbarManagerProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [queue, setQueue] = useState<DisplayItem[]>([]);
  const [visibleItems, setVisibleItems] = useState<DisplayItem[]>([]);
  const durationMap = useRef<Record<string, number>>({});
  const seenIds = useRef<Set<string>>(new Set(notifications.map(n => n.id)));
  const enqueuedTransientIds = useRef<Set<string>>(new Set());
  // ADR-374 FU-695: rows older than this (server-feed baseline) are marked seen
  // silently — a first /api/notifications reconcile after mount must not toast
  // the whole backlog at once.
  const baselineAt = useRef(Date.now() + 2000);

  // Enqueue new unread persistent notifications
  useEffect(() => {
    const incoming = notifications
      .filter(n => !n.read && !n.archived && !seenIds.current.has(n.id))
      .filter(n => {
        if (n.timestamp.getTime() < baselineAt.current) {
          seenIds.current.add(n.id); // pre-session baseline → mark seen, no toast
          return false;
        }
        return true;
      })
      .map(n => {
        seenIds.current.add(n.id);
        return toPersistentItem(n);
      });
    if (incoming.length > 0) setQueue(prev => [...prev, ...incoming]);
  }, [notifications]);

  // Enqueue transient snackbar items from incoming transientSnackbar prop
  useEffect(() => {
    if (!transientSnackbar) return;
    if (enqueuedTransientIds.current.has(transientSnackbar.id)) return;
    enqueuedTransientIds.current.add(transientSnackbar.id);
    const item: DisplayItem = {
      kind: 'transient',
      id: transientSnackbar.id,
      message: transientSnackbar.message,
      severity: transientSnackbar.severity,
      undoLabel: transientSnackbar.undoLabel,
      onUndo: transientSnackbar.onUndo,
      duration: transientSnackbar.duration,
    };
    durationMap.current[item.id] =
      item.kind === 'transient' && item.duration ? item.duration : DEFAULT_DURATION;
    setQueue(prev => [...prev, item]);
  }, [transientSnackbar]);

  // Advance queue: fill visibleItems up to MAX_VISIBLE (batch via raf)
  useEffect(() => {
    if (queue.length === 0) return;
    if (visibleItems.length >= MAX_VISIBLE) return;
    const raf = requestAnimationFrame(() => {
      const toAdd = queue.slice(0, MAX_VISIBLE - visibleItems.length);
      if (toAdd.length === 0) return;
      toAdd.forEach(item => {
        durationMap.current[item.id] =
          item.kind === 'transient' && item.duration ? item.duration : DEFAULT_DURATION;
      });
      setVisibleItems(prev => [...prev, ...toAdd]);
      setQueue(prev => prev.slice(toAdd.length));
    });
    return () => cancelAnimationFrame(raf);
  }, [queue, visibleItems.length]);

  const handleDismiss = useCallback((id: string) => {
    const item = visibleItems.find(i => i.id === id);
    if (!item) return;
    if (item.kind === 'transient') {
      enqueuedTransientIds.current.delete(id);
    }
    setVisibleItems(prev => prev.filter(i => i.id !== id));
    if (item.kind === 'transient') {
      setTimeout(() => onTransientConsumed(id), 0);
    }
  }, [visibleItems, onTransientConsumed]);

  if (visibleItems.length === 0) return null;

  const totalVisible = visibleItems.length;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: isMobile
          ? 'calc(58px + env(safe-area-inset-bottom, 0px) + 12px)'
          : 24,
        right: isMobile ? 12 : 20,
        left: isMobile ? 12 : 'auto',
        zIndex: 1400,
        display: 'flex',
        flexDirection: 'column-reverse',
        alignItems: 'flex-end',
        gap: 0,
      }}
    >
      {visibleItems.map((item, index) => {
        const handleView =
          item.kind === 'persistent'
            ? () => navigate(`/notifications?expand=${encodeURIComponent(item.groupKey)}`)
            : undefined;
        const translateY = index * TOAST_STEP;
        return (
          <div
            key={item.id}
            style={{
              transform: `translateY(-${translateY}px)`,
              transition: 'transform 300ms ease',
              zIndex: totalVisible - index,
            }}
          >
            <Toast
              item={item}
              duration={durationMap.current[item.id] ?? DEFAULT_DURATION}
              isMobile={isMobile}
              onDismiss={() => handleDismiss(item.id)}
              onView={handleView}
            />
          </div>
        );
      })}
    </div>
  );
}
