// ADR-384: one shared view of the user's (or guest's) hosted-AI credits, kept in
// sync across every surface (Home section, FAB panel, /ai page, Settings) through
// a window event. Chat turns announce the live count from the SSE provider-info
// event, purchases announce the new balance, so nothing has to poll.
import { useCallback, useEffect, useState } from 'react';
import { apiCall } from '../../lib/api';

export interface AiCreditTier { id: string; requests: number; priceSats: number }

const EVENT = 'colabonate:ai-credits-changed';
const GUEST_KEY = 'aiGuestSessionId';
const PEAK_KEY = 'aiCreditsPeak';

/** Tell every mounted surface the balance changed (pass the new count if known). */
export function announceAiCredits(remaining?: number): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { remaining } }));
}

export function isAiGuest(): boolean {
  return !localStorage.getItem('authToken');
}

/** True when hosted credits are what this user actually chats with right now. */
export function isHostedModeActive(): boolean {
  if (isAiGuest()) return Boolean(localStorage.getItem(GUEST_KEY));
  return localStorage.getItem('aiProvider') === 'platform';
}

function readPeak(): number {
  const n = Number(localStorage.getItem(PEAK_KEY));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Several surfaces mount this hook at once (Home section, panel, bar, Account).
// Share one in-flight request so N instances cost one GET, not N.
type CreditsPayload = { requestsRemaining: number; requestsUsed?: number; tiers: AiCreditTier[]; hostedEnabled?: boolean; salesPaused?: boolean; sectionHidden?: boolean };
let inflight: Promise<CreditsPayload> | null = null;
function fetchCredits(url: string): Promise<CreditsPayload> {
  if (!inflight) {
    inflight = apiCall(url)
      .then((r) => r.json() as Promise<CreditsPayload>)
      .finally(() => { setTimeout(() => { inflight = null; }, 400); });
  }
  return inflight;
}

export function useAiCredits() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [used, setUsed] = useState<number>(0);
  // ADR-384 hard gate: packs are only offered once the operator switched hosted AI on.
  const [hostedEnabled, setHostedEnabled] = useState(false);
  // ADR-405: platform-wide close-only flags (sales pause + Home-section hide).
  const [salesPaused, setSalesPaused] = useState(false);
  const [sectionHidden, setSectionHidden] = useState(false);
  const [tiers, setTiers] = useState<AiCreditTier[]>([]);
  const [peak, setPeak] = useState<number>(() => readPeak());

  const applyRemaining = useCallback((n: number) => {
    setRemaining(n);
    // The "full" mark of the meter = the most credits seen at once, so the bar
    // reads as "how much of my last top-up is left".
    const nextPeak = Math.max(readPeak(), n);
    localStorage.setItem(PEAK_KEY, String(nextPeak));
    setPeak(nextPeak);
  }, []);

  const refresh = useCallback(async () => {
    const guest = isAiGuest();
    try {
      const url = guest
        ? `/api/ai/credits/guest?guestSessionId=${localStorage.getItem(GUEST_KEY) ?? ''}`
        : '/api/ai/credits';
      const data = await fetchCredits(url);
      setTiers(data.tiers);
      setUsed(data.requestsUsed ?? 0);
      setHostedEnabled(Boolean(data.hostedEnabled));
      setSalesPaused(Boolean(data.salesPaused));
      setSectionHidden(Boolean(data.sectionHidden));
      applyRemaining(data.requestsRemaining);
    } catch {
      // stay silent: surfaces render without the credits block
    }
  }, [applyRemaining]);

  useEffect(() => {
    void refresh();
    const onChange = (e: Event) => {
      const n = (e as CustomEvent<{ remaining?: number }>).detail?.remaining;
      // Instant number for the meter, then a refresh so `used` stays exact too.
      if (typeof n === 'number') applyRemaining(n);
      void refresh();
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [refresh, applyRemaining]);

  return { remaining, used, tiers, peak, hostedEnabled, salesPaused, sectionHidden, refresh };
}
