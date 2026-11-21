import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiCall } from '../lib/api';
import type { Cooperation } from '../hooks/useEntityQueries';
import type { PollingBarStatus } from '@ds/ui';
import type { Notification } from '@ds/ui';

const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 30_000;

// ── Server feed mapping (ADR-374 FU-695) ───────────────────────────────────
// /api/notifications is the authoritative source for the events the server
// records (ticket created/status, dispute, coop status, verdict, arbiter).
// Locally-derived rows for events the server does NOT record yet (NIP-17 chat
// messages, coop milestone / partner events, ticket milestone events) survive
// the reconcile so nothing the drawer shows today disappears.

interface ServerNotification {
  id: string;
  type: string;
  title: string;
  message?: string | null;
  relatedId?: string | null;
  actionUrl?: string | null;
  meta?: Record<string, unknown> | null;
  read: boolean;
  archived: boolean;
  createdAt: string;
}

function mapServerNotification(n: ServerNotification): Notification {
  // dispute rows render as ticket; ADR-397 D5 bounty rows use the offer style;
  // ADR-411: 'ai' rows keep their own type (previously swallowed into 'system').
  const raw = n.type === 'dispute' ? 'ticket' : n.type === 'bounty' ? 'offer' : n.type;
  const type: Notification['type'] =
    raw === 'ticket' || raw === 'cooperation' || raw === 'offer' || raw === 'message' || raw === 'system' || raw === 'ai'
      ? raw
      : 'system';
  return {
    id: n.id,
    type,
    title: n.title,
    message: n.message ?? '',
    timestamp: new Date(n.createdAt),
    read: n.read,
    archived: n.archived,
    relatedId: n.relatedId ?? undefined,
    actionUrl: n.actionUrl ?? undefined,
    meta: (n.meta ?? undefined) as Notification['meta'],
  };
}

/** Local rows the server feed does not (yet) own — kept across the reconcile. */
function isLocalOnlyNotification(n: Notification): boolean {
  // ADR-397 D5: server bounty rows render as 'offer' but are server-owned.
  if ((n.meta as Record<string, unknown> | undefined)?.bountyTitle) return false;
  return (
    n.type === 'message' ||
    n.type === 'offer' ||
    n.type === 'system' ||
    !!n.meta?.milestoneId ||
    (n.type === 'cooperation' && !n.meta?.statusTo && !!n.meta?.partnerPubkey)
  );
}

export interface TransientSnackbar {
  id: string;
  message: string;
  severity: 'success' | 'info' | 'warning' | 'error';
  undoLabel?: string;
  onUndo?: () => void;
  duration?: number;
}

export type TransientSnackbarQueue = TransientSnackbar[];

export interface SnackbarWithUndoParams {
  message: string;
  severity: 'success' | 'info' | 'warning' | 'error';
  undoLabel?: string;
  onUndo?: () => void;
  duration?: number;
}

// ── Polling Bar Context (high-frequency: updates every COUNTDOWN_TICK ms) ──
// Isolated so that only Layout + Tickets re-render on each countdown tick.
export interface PollingBarContextValue {
  pollTick: number;
  barStatus: PollingBarStatus;
  progress: number;
  countdownTick: number;
  newTicketCount: number;
  clearNewTickets: () => void;
}

const PollingBarContext = createContext<PollingBarContextValue | null>(null);

// ── Notification Context (low-frequency: notifications, snackbar) ────────
interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAllNotifications: () => void;
  archiveNotification: (id: string) => void;
  archiveNotificationGroup: (relatedId: string) => void;
  transientSnackbarQueue: TransientSnackbar[];
  showSnackbar: (message: string, severity: 'success' | 'info' | 'warning' | 'error') => void;
  showSnackbarWithUndo: (params: SnackbarWithUndoParams) => void;
  clearTransientSnackbar: (id?: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [pubkey, setPubkey] = useState<string | null>(() => localStorage.getItem('pubkey'));

  useEffect(() => {
    const onChange = (e: StorageEvent) => {
      if (e.key === 'pubkey') setPubkey(e.newValue);
    };
    const onCustom = () => setPubkey(localStorage.getItem('pubkey'));
    window.addEventListener('storage', onChange);
    window.addEventListener('pubkey-changed', onCustom);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('pubkey-changed', onCustom);
    };
  }, []);

  // Existing ticket polling state
  const [barStatus, setBarStatus] = useState<PollingBarStatus>('idle');
  const [pollTick, setPollTick] = useState(0);
  const [progress, setProgress] = useState(0);
  const [newTicketCount, setNewTicketCount] = useState(0);
  
  // Transient snackbar queue (not persisted)
  const [transientSnackbarQueue, setTransientSnackbarQueue] = useState<TransientSnackbar[]>([]);

  // Notification state – nur laden wenn eingeloggt
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    if (!localStorage.getItem('pubkey')) return [];
    const saved = localStorage.getItem('notifications');
    if (saved) {
      const parsed = JSON.parse(saved) as Array<Notification & { timestamp: string | Date }>;
      const seen = new Map<string, number>();
      return parsed
        .map(n => ({ ...n, timestamp: new Date(n.timestamp) }))
        .filter((n) => {
          const count = (seen.get(n.id) ?? 0) + 1;
          seen.set(n.id, count);
          return count === 1;
        });
    }
    return [];
  });
  
  const unreadCount = notifications.filter(n => !n.read && !n.archived).length;
  
  const stateRef = useRef({
    lastTicketIds: new Set<string>(),
    lastTicketStates: new Map<string, {
      status: string;
      updatedAt: string;
      escrowStatus: string;
      milestoneStates: Map<string, string>;
    }>(),
    lastCooperationStates: new Map<string, {
      status: string;
      partnerPubkey: string | null;
      updatedAt: string;
      milestoneStates: Map<string, string>;
      milestonePartners: Map<string, string | null>;
    }>(),
    isFirstPoll: true,
    coopFirstPoll: true,
    foundTimer: null as ReturnType<typeof setTimeout> | null,
  });

  // Mirror of `notifications` for reading the latest value from polling
  // callbacks without re-running the polling effect on every notif change.
  const notificationsRef = useRef<Notification[]>(notifications);

  // Server rows seen in the latest /api/notifications reconcile — mutations
  // write through to the server only for these ids (FU-695).
  const serverIdsRef = useRef<Set<string>>(new Set());

  /**
   * ADR-374 FU-695: fetch the server-backed feed and reconcile it with the
   * local state. Server rows are authoritative for the events the server
   * records; locally-derived rows for events the server does not record yet
   * (chat messages, milestone / partner events) are kept.
   */
  const refreshServerFeed = useCallback(async () => {
    try {
      const [activeRes, archivedRes] = await Promise.all([
        apiCall('/api/notifications?limit=100'),
        apiCall('/api/notifications?archived=1&limit=200'),
      ]);
      const [activeData, archivedData] = await Promise.all([
        activeRes.json() as Promise<{ notifications?: ServerNotification[] }>,
        archivedRes.json() as Promise<{ notifications?: ServerNotification[] }>,
      ]);
      const serverRows = [
        ...(activeData.notifications ?? []),
        ...(archivedData.notifications ?? []),
      ].map(mapServerNotification);
      const serverIds = new Set(serverRows.map(n => n.id));
      serverIdsRef.current = serverIds;
      setNotifications(prev => {
        const keptLocal = prev.filter(p => !serverIds.has(p.id) && isLocalOnlyNotification(p));
        const merged = [...serverRows, ...keptLocal];
        return merged.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      });
    } catch {
      // silent — the local feed remains as fallback (apiCall handles 401)
    }
  }, []);

  // Save notifications to localStorage nur wenn eingeloggt
  useEffect(() => {
    notificationsRef.current = notifications;
    if (!localStorage.getItem('pubkey')) return;
    localStorage.setItem('notifications', JSON.stringify(notifications));
  }, [notifications]);

  // Reagiere auf externen localStorage-Wipe (z.B. Protocol Simulator DB-Wipe)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'notifications' && e.newValue === null) {
        setNotifications([]);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Existing ticket polling logic
  useEffect(() => {
    if (!pubkey) {
      setBarStatus('idle');
      return;
    }

    const s = stateRef.current;
    s.isFirstPoll = true;
    s.coopFirstPoll = true;
    s.lastTicketIds = new Set<string>();
    s.lastTicketStates.clear();
    s.lastCooperationStates.clear();

    // Poll function
    const doPoll = async () => {
      if (s.foundTimer) { clearTimeout(s.foundTimer); s.foundTimer = null; }

      // NOTE (ADR-206 follow-up): progress is not set here during 'fetching'.
      // PollingBar's 'fetching' state ignores the progress value entirely
      // (it uses the CSS `polling-scan` keyframe animation), so setting
      // progress 20/75/100 here were no-ops that only triggered 3 extra
      // Layout re-renders per poll cycle. progress is still reset to 0 below.
      setBarStatus('fetching');

      try {
        const response = await apiCall(`/api/tickets?pubkey=${pubkey}`);
        const data = await response.json();

        const tickets: Array<{
          id: string;
          offer?: { title?: string; priceSats?: number };
          buyerPubkey?: string;
          sellerPubkey?: string;
          status?: string;
          amountSats?: number;
          ticketType?: string;
          offerType?: 'SERVICE' | 'PRODUCT' | 'ITEM' | 'AGENT_SETUP';
          escrowStatus?: string;
          createdAt?: string;
          updatedAt?: string;
          milestones?: Array<{ id: string; title: string; status: string; amountSats?: number }>;
        }> = data.tickets ?? [];
        const newIds = new Set(tickets.map((t) => t.id));

        const MILESTONE_TRANSITION_TITLE: Record<string, string> = {
          ACCEPTED: 'Milestone accepted',
          IN_PROGRESS: 'Milestone started',
          COMPLETED: 'Milestone completed',
          DISPUTED: 'Milestone disputed',
        };

        const currentPubkey = pubkey;

        if (s.isFirstPoll) {
          s.isFirstPoll = false;
          s.lastTicketIds = newIds;
          for (const t of tickets) {
            s.lastTicketStates.set(t.id, {
              status: t.status ?? 'UNKNOWN',
              updatedAt: t.updatedAt ?? '',
              escrowStatus: t.escrowStatus ?? '',
              milestoneStates: new Map(
                (t.milestones ?? []).map(m => [m.id, m.status]),
              ),
            });
          }
          setPollTick((n) => n + 1);
          setBarStatus('scanning');
          setProgress(0);
          return;
        }

        const hasNew = tickets.some((t) => !s.lastTicketIds.has(t.id));
        setPollTick((n) => n + 1);

        // NOTE (ADR-374 FU-695): ticket-status transitions are no longer derived
        // client-side — the server writes them to /api/notifications (the feed is
        // reconciled each poll). Only TICKET MILESTONE transitions are still
        // derived locally (the milestone route records no actor server-side).
        const milestoneChangedTickets: Array<{
          ticket: typeof tickets[number];
          milestone: NonNullable<typeof tickets[number]['milestones']>[number];
          milestoneIndex: number;
          prevMilestoneStatus: string;
        }> = [];

        for (const t of tickets) {
          const prev = s.lastTicketStates.get(t.id);
          if (prev && t.milestones) {
            for (let idx = 0; idx < t.milestones.length; idx++) {
              const m = t.milestones[idx];
              const prevMStatus = prev.milestoneStates.get(m.id);
              if (prevMStatus !== undefined && prevMStatus !== m.status) {
                milestoneChangedTickets.push({
                  ticket: t,
                  milestone: m,
                  milestoneIndex: idx,
                  prevMilestoneStatus: prevMStatus,
                });
              }
            }
          }
        }

        milestoneChangedTickets.forEach(({ ticket, milestone, milestoneIndex, prevMilestoneStatus }) => {
          const isBuyer = ticket.buyerPubkey === currentPubkey;
          const partnerPubkey = isBuyer ? ticket.sellerPubkey : ticket.buyerPubkey;
          addNotification({
            type: 'ticket',
            title: MILESTONE_TRANSITION_TITLE[milestone.status] ?? 'Milestone changed',
            message: `${milestone.title} — ${ticket.offer?.title ?? `#${ticket.id.slice(0, 8)}`}`,
            relatedId: ticket.id,
            actionUrl: `/tickets/${ticket.id}`,
            meta: {
              offerTitle: ticket.offer?.title,
              statusFrom: prevMilestoneStatus,
              statusTo: milestone.status,
              partnerPubkey,
              amountSats: ticket.amountSats ?? ticket.offer?.priceSats,
              role: isBuyer ? 'buyer' : 'seller',
              ticketId: ticket.id,
              ticketType: ticket.ticketType,
              offerType: ticket.offerType,
              buyerPubkey: ticket.buyerPubkey,
              sellerPubkey: ticket.sellerPubkey,
              escrowStatus: ticket.escrowStatus,
              createdAt: ticket.createdAt,
              updatedAt: ticket.updatedAt,
              milestoneId: milestone.id,
              milestoneTitle: milestone.title,
              milestoneIndex,
            },
          });
        });

        const syncTicketStates = () => {
          for (const t of tickets) {
            s.lastTicketStates.set(t.id, {
              status: t.status ?? 'UNKNOWN',
              updatedAt: t.updatedAt ?? '',
              escrowStatus: t.escrowStatus ?? '',
              milestoneStates: new Map(
                (t.milestones ?? []).map(m => [m.id, m.status]),
              ),
            });
          }
          for (const id of s.lastTicketStates.keys()) {
            if (!newIds.has(id)) s.lastTicketStates.delete(id);
          }
          s.lastTicketIds = newIds;
        };

        // NOTE (ADR-206 FU-206-C): cooperation polling moved OUT of doPoll.
        // Cooperations are now fetched via the shared react-query cache
        // `['cooperations', pubkey]` (see useCooperations + the effect below),
        // so the network request is deduped to ONE per cycle instead of two
        // (NotificationContext manual fetch + useCooperations). Ticket polling
        // continues here unchanged.

        if (hasNew) {
          const addedCount = tickets.filter((t) => !s.lastTicketIds.has(t.id)).length;
          setNewTicketCount(addedCount);

          // NOTE (ADR-374 FU-695): the "new ticket" notification is written by
          // the server at ticket creation (POST /api/tickets → seller). The
          // poll only drives the polling bar / count now.

          syncTicketStates();
          setBarStatus('found');
          s.foundTimer = setTimeout(() => {
            s.foundTimer = null;
            setBarStatus('scanning');
            setProgress(0);
          }, 1400);
        } else {
          syncTicketStates();
          setBarStatus('scanning');
          setProgress(0);
        }
      } catch {
        setBarStatus('error');
        s.foundTimer = setTimeout(() => {
          s.foundTimer = null;
            setBarStatus('scanning');
            setProgress(0);
          }, 2600);
      }
    };

    doPoll();
    const intervalId = setInterval(doPoll, POLL_INTERVAL);

    return () => {
      clearInterval(intervalId);
      if (s.foundTimer) clearTimeout(s.foundTimer);
    };
  }, [pubkey]);

  // ADR-374 FU-695: reconcile the server-backed notification feed on mount and
  // after every successful ticket-poll cycle (pollTick advances on each).
  useEffect(() => {
    if (!pubkey) return;
    void refreshServerFeed();
  }, [pubkey, pollTick, refreshServerFeed]);

  // addNotification is hoisted above the cooperation-diff effect below so it is
  // in scope when that effect's dependency array is evaluated at render.
  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const newNotification: Notification = {
      ...notification,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      read: false,
    };
    setNotifications(prev => [newNotification, ...prev]);
  }, []);

  // ── Cooperation polling via shared react-query cache (ADR-206 FU-206-C) ──
  // Same queryKey as useCooperations() → react-query dedupes to ONE network
  // request per cycle. Cache holds the RAW Cooperation[] (with milestones);
  // useCooperations derives its CoopItem[] view via `select`. This effect only
  // diffs the cached data into notifications (status / partner / milestone).
  const { data: cooperations } = useQuery<Cooperation[]>({
    queryKey: ['cooperations', pubkey],
    queryFn: async () => {
      const res = await apiCall(`/api/cooperations?pubkey=${pubkey}`)
      const data = await res.json()
      return data.cooperations ?? []
    },
    enabled: !!pubkey,
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })

  useEffect(() => {
    const coops = cooperations ?? []
    const s = stateRef.current

    const COOP_STATUS_TITLE: Record<string, string> = {
      ACCEPTED: 'Cooperation accepted',
      PAID: 'Escrow funded – work can begin',
      IN_PROGRESS: 'Cooperation in progress',
      COMPLETED: 'Cooperation completed',
      CANCELLED: 'Cooperation cancelled',
    }
    const COOP_MILESTONE_TITLE: Record<string, string> = {
      IN_PROGRESS: 'Milestone started',
      COMPLETED: 'Milestone submitted – awaiting approval',
      ACCEPTED: 'Milestone approved – funds released',
      DISPUTED: 'Milestone disputed',
    }

    // First arrival after a pubkey (re)load seeds the baseline silently,
    // matching the previous `if (!s.isFirstPoll)` guard in doPoll.
    if (s.coopFirstPoll) {
      s.coopFirstPoll = false
      for (const coop of coops) {
        s.lastCooperationStates.set(coop.id, {
          status: coop.status ?? 'OPEN',
          partnerPubkey: coop.partnerPubkey ?? null,
          updatedAt: coop.createdAt ?? '',
          milestoneStates: new Map((coop.milestones ?? []).map(m => [m.id, m.status])),
          milestonePartners: new Map((coop.milestones ?? []).map(m => [m.id, m.partnerPubkey ?? null])),
        })
      }
      return
    }

    for (const coop of coops) {
      const prev = s.lastCooperationStates.get(coop.id)
      const curStatus = coop.status ?? 'OPEN'
      const curPartner = coop.partnerPubkey ?? null

      if (prev) {
        // NOTE (ADR-374 FU-695): cooperation status transitions are written by
        // the server (PATCH /api/cooperations/:id/status → /api/notifications),
        // so no drawer row is derived here — only the transient success
        // snackbar for accepted/completed cooperations remains.
        if (prev.status !== curStatus) {
          const titleText = COOP_STATUS_TITLE[curStatus]
          if (titleText && (curStatus === 'ACCEPTED' || curStatus === 'COMPLETED')) {
            setTransientSnackbarQueue(q => [...q, {
              id: `coop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              message: titleText,
              severity: 'success' as const,
            }])
          }
        }
        if (!prev.partnerPubkey && curPartner) {
          addNotification({
            type: 'cooperation',
            title: 'New partner applied',
            message: coop.title ?? `Cooperation #${coop.id.slice(0, 8)}`,
            relatedId: coop.id,
            actionUrl: `/coop/${coop.id}`,
            meta: { cooperationId: coop.id, partnerPubkey: curPartner },
          })
          setTransientSnackbarQueue(q => [...q, {
            id: `coop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            message: 'New partner applied to your cooperation',
            severity: 'info' as const,
          }])
        }
        for (const m of coop.milestones ?? []) {
          const prevMStatus = prev.milestoneStates.get(m.id)
          if (prevMStatus !== undefined && prevMStatus !== m.status) {
            const notifTitle = COOP_MILESTONE_TITLE[m.status]
            if (notifTitle) {
              addNotification({
                type: 'cooperation',
                title: notifTitle,
                message: m.title
                  ? `${m.title} — ${coop.title ?? `#${coop.id.slice(0, 8)}`}`
                  : coop.title ?? `Cooperation #${coop.id.slice(0, 8)}`,
                relatedId: coop.id,
                actionUrl: `/coop/${coop.id}`,
                meta: {
                  cooperationId: coop.id,
                  statusFrom: prevMStatus,
                  statusTo: m.status,
                  milestoneId: m.id,
                  milestoneTitle: m.title,
                },
              })
              if (m.status === 'COMPLETED' || m.status === 'ACCEPTED') {
                setTransientSnackbarQueue(q => [...q, {
                  id: `ms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  message: notifTitle,
                  severity: m.status === 'ACCEPTED' ? 'success' as const : 'info' as const,
                }])
              }
            }
          }
          const prevPartner = prev.milestonePartners.get(m.id)
          const mPartner = m.partnerPubkey ?? null
          if (prevPartner === null && mPartner !== null && mPartner === pubkey) {
            addNotification({
              type: 'cooperation',
              title: 'Application accepted – you are assigned',
              message: m.title
                ? `${m.title} — ${coop.title ?? `#${coop.id.slice(0, 8)}`}`
                : coop.title ?? `Cooperation #${coop.id.slice(0, 8)}`,
              relatedId: coop.id,
              actionUrl: `/coop/${coop.id}`,
              meta: { cooperationId: coop.id, milestoneId: m.id, milestoneTitle: m.title },
            })
            setTransientSnackbarQueue(q => [...q, {
              id: `ms-assign-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              message: `Application accepted: ${m.title ?? 'milestone'}`,
              severity: 'success' as const,
            }])
          }
        }
      }
    }

    // Sync cooperation states for next diff
    for (const coop of coops) {
      s.lastCooperationStates.set(coop.id, {
        status: coop.status ?? 'OPEN',
        partnerPubkey: coop.partnerPubkey ?? null,
        updatedAt: coop.createdAt ?? '',
        milestoneStates: new Map((coop.milestones ?? []).map(m => [m.id, m.status])),
        milestonePartners: new Map((coop.milestones ?? []).map(m => [m.id, m.partnerPubkey ?? null])),
      })
    }
    for (const id of s.lastCooperationStates.keys()) {
      if (!coops.find(c => c.id === id)) s.lastCooperationStates.delete(id)
    }
  }, [cooperations, pubkey, addNotification, setTransientSnackbarQueue])

  // Clear new tickets (existing functionality)
  const clearNewTickets = useCallback(() => setNewTicketCount(0), []);

  // New notification methods (addNotification defined above, near the polling effects)
  // ADR-374 FU-695: read/archive mutations write through to the server feed
  // (PATCH /api/notifications/:id, POST /api/notifications/read-all) for rows
  // that came from the server — best-effort, never blocks the local update.

  const patchServerNotification = useCallback((id: string, body: Record<string, boolean>) => {
    if (!serverIdsRef.current.has(id)) return;
    apiCall(`/api/notifications/${id}`, { method: 'PATCH', body: JSON.stringify(body) }).catch(() => {
      /* best-effort */
    });
  }, []);

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev =>
      prev.map(notification =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );
    patchServerNotification(id, { read: true });
  }, [patchServerNotification]);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev =>
      prev.map(notification => ({ ...notification, read: true }))
    );
    apiCall('/api/notifications/read-all', { method: 'POST', body: JSON.stringify({}) }).catch(() => {
      /* best-effort */
    });
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(notification => notification.id !== id));
  }, []);

  const clearAllNotifications = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, archived: true, read: true })));
    // Archive every active server row individually (no bulk-archive endpoint).
    notificationsRef.current
      .filter(n => serverIdsRef.current.has(n.id) && !n.archived)
      .forEach(n => {
        apiCall(`/api/notifications/${n.id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }).catch(() => {
          /* best-effort */
        });
      });
  }, []);

  const archiveNotification = useCallback((id: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, archived: true, read: true } : n)
    );
    patchServerNotification(id, { archived: true });
  }, [patchServerNotification]);

  const archiveNotificationGroup = useCallback((relatedId: string) => {
    setNotifications(prev =>
      prev.map(n =>
        (n.relatedId === relatedId || n.meta?.ticketId === relatedId)
          ? { ...n, archived: true, read: true }
          : n
      )
    );
    notificationsRef.current
      .filter(n =>
        (n.relatedId === relatedId || n.meta?.ticketId === relatedId) &&
        serverIdsRef.current.has(n.id) &&
        !n.archived
      )
      .forEach(n => {
        apiCall(`/api/notifications/${n.id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }).catch(() => {
          /* best-effort */
        });
      });
  }, []);

  const showSnackbar = useCallback((message: string, severity: 'success' | 'info' | 'warning' | 'error') => {
    setTransientSnackbarQueue(prev => [
      ...prev,
      {
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message,
        severity,
      },
    ])
  }, []);

  const showSnackbarWithUndo = useCallback((params: SnackbarWithUndoParams) => {
    setTransientSnackbarQueue(prev => [
      ...prev,
      {
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message: params.message,
        severity: params.severity,
        undoLabel: params.undoLabel,
        onUndo: params.onUndo,
        duration: params.duration,
      },
    ])
  }, []);

  const clearTransientSnackbar = useCallback((id?: string) => {
    if (!id) {
      setTransientSnackbarQueue([])
    } else {
      setTransientSnackbarQueue(prev => prev.filter(s => s.id !== id))
    }
  }, []);

  const pollingBarValue = useMemo<PollingBarContextValue>(
    () => ({ pollTick, barStatus, progress, countdownTick: POLL_INTERVAL, newTicketCount, clearNewTickets }),
    [pollTick, barStatus, progress, newTicketCount, clearNewTickets],
  );

  const notificationValue = useMemo<NotificationContextValue>(
    () => ({
      notifications,
      unreadCount,
      addNotification,
      markAsRead,
      markAllAsRead,
      removeNotification,
      clearAllNotifications,
      archiveNotification,
      archiveNotificationGroup,
      transientSnackbarQueue,
      showSnackbar,
      showSnackbarWithUndo,
      clearTransientSnackbar,
    }),
    [
      notifications, unreadCount, transientSnackbarQueue,
      addNotification, markAsRead, markAllAsRead, removeNotification,
      clearAllNotifications, archiveNotification, archiveNotificationGroup,
      showSnackbar, showSnackbarWithUndo, clearTransientSnackbar,
    ],
  );

  return (
    <PollingBarContext.Provider value={pollingBarValue}>
      <NotificationContext.Provider value={notificationValue}>
        {children}
      </NotificationContext.Provider>
    </PollingBarContext.Provider>
  );
}

export function usePollingBar(): PollingBarContextValue {
  const ctx = useContext(PollingBarContext);
  if (!ctx) throw new Error('usePollingBar muss innerhalb von NotificationProvider verwendet werden');
  return ctx;
}

export function useNotification(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification muss innerhalb von NotificationProvider verwendet werden');
  return ctx;
}