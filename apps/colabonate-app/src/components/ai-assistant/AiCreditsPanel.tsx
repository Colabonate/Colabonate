// ADR-384 D2/D5 — Colabonate-hosted AI credit packs. Fixed-price packs paid
// directly to Colabonate's own Lightning address (non-custodial, same rail as
// ADR-351/372); DEMO rail on the closed beta. Shown in Settings → AI.
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import { apiCall } from '../../lib/api';
import { usePayment } from '../../hooks/usePayment';
import { SatsAmount } from '../currency/SatsAmount';
import { announceAiCredits } from './useAiCredits';
import { PackCard } from './PackCard';

interface Tier { id: string; requests: number; priceSats: number }
interface CreditsView { requestsRemaining: number; requestsUsed: number; tiers: Tier[]; hostedEnabled?: boolean }
const GUEST_KEY = 'aiGuestSessionId';

interface PendingLn { purchaseId: string; invoice: string; needsPreimage: boolean }

export function AiCreditsPanel({ onBalanceChange, onClose, autoBuyTierId }: { onBalanceChange?: (remaining: number) => void; onClose?: () => void; autoBuyTierId?: string }) {
  const { payInvoice } = usePayment();
  // ADR-384 D10: no login → anonymous session credits, tied to this browser.
  const guest = !localStorage.getItem('authToken');
  const base = guest ? '/api/ai/credits/guest' : '/api/ai/credits';
  const guestId = () => localStorage.getItem(GUEST_KEY);
  const [view, setView] = useState<CreditsView | null>(null);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<PendingLn | null>(null);
  const [preimage, setPreimage] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiCall(guest ? `${base}?guestSessionId=${guestId() ?? ''}` : base);
      const data = (await res.json()) as CreditsView;
      setView(data);
      onBalanceChange?.(data.requestsRemaining);
    } catch {
      // panel stays in its loading state; the rest of the Settings tab is unaffected
    }
  }, [onBalanceChange, guest, base]);

  useEffect(() => { void load(); }, [load]);

  const confirm = async (purchaseId: string, pre?: string): Promise<boolean> => {
    try {
      const res = await apiCall(`${base}/purchase/${purchaseId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ ...(pre ? { preimage: pre } : {}), ...(guest ? { guestSessionId: guestId() } : {}) }),
      });
      const data = await res.json();
      setMessage({ kind: 'ok', text: `Credits added. ${data.requestsRemaining} requests available.` });
      setPending(null);
      setPreimage('');
      await load();
      announceAiCredits(data.requestsRemaining);
      return true;
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Confirmation failed' });
      return false;
    }
  };

  const buy = async (tier: Tier) => {
    if (busyTier) return;
    setBusyTier(tier.id);
    setMessage(null);
    setPending(null);
    try {
      const res = await apiCall(`${base}/purchase`, { method: 'POST', body: JSON.stringify({ tier: tier.id, ...(guest && guestId() ? { guestSessionId: guestId() } : {}) }) });
      const purchase = (await res.json()) as { guestSessionId?: string; id: string; rail: 'LN' | 'DEMO'; invoice: string | null; paymentHash: string | null };

      // Persist the guest id BEFORE paying, so a paid-but-unconfirmed purchase can still be confirmed.
      if (guest && purchase.guestSessionId) localStorage.setItem(GUEST_KEY, purchase.guestSessionId);

      if (purchase.rail === 'DEMO') {
        await confirm(purchase.id);
        return;
      }
      if (!purchase.invoice || !purchase.paymentHash) {
        setMessage({ kind: 'error', text: 'Invoice missing' });
        return;
      }
      const paid = await payInvoice({ invoice: purchase.invoice, paymentHash: purchase.paymentHash });
      if (paid.ok && paid.preimage) {
        await confirm(purchase.id, paid.preimage);
      } else {
        // No wallet-provided preimage (or no wallet): fall back to manual pay + preimage paste.
        if (!paid.ok && paid.error) setMessage({ kind: 'error', text: paid.error });
        setPending({ purchaseId: purchase.id, invoice: purchase.invoice, needsPreimage: true });
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Purchase failed';
      setMessage({
        kind: 'error',
        text: text === 'PLATFORM_PAYMENT_NOT_CONFIGURED' ? 'Buying credits is not available on this deployment yet.' : text,
      });
    } finally {
      setBusyTier(null);
    }
  };

  // A splash-screen tier button starts that purchase as soon as the tiers are loaded (once).
  const autoBought = useRef(false);
  useEffect(() => {
    if (!autoBuyTierId || autoBought.current || !view) return;
    const tier = view.tiers.find((t) => t.id === autoBuyTierId);
    if (!tier) return;
    autoBought.current = true;
    void buy(tier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBuyTierId, view]);

  if (!view) return null;

  // Hard gate (ADR-384): while hosted AI is not switched on there is nothing to buy.
  if (!view.hostedEnabled) {
    return (
      <div className="flex flex-col gap-5 pt-1">
        <p className="text-[15px] leading-relaxed m-0" style={{ color: 'var(--theme-text-muted)' }}>
          Colabonate Hosted is not available yet, so credit packs cannot be bought right now. You can use the assistant
          with your own API key or a local model in Settings.
          {view.requestsRemaining > 0 && ` Your ${view.requestsRemaining} existing requests stay yours.`}
        </p>
        {onClose && (
          <div className="flex items-center justify-end">
            <Button variant="outlined" onClick={onClose} sx={{ fontWeight: 600, borderRadius: '10px', px: 3, py: 1, color: 'var(--theme-text-muted)', borderColor: 'var(--theme-border)' }}>
              Close
            </Button>
          </div>
        )}
      </div>
    );
  }

  const active = view.tiers.find((t) => t.id === busyTier) ?? null;
  // Lowest price per request = "best value"; the middle pack is the "popular" default.
  const perReq = (t: Tier) => t.priceSats / t.requests;
  const bestId = view.tiers.reduce((a, b) => (perReq(b) < perReq(a) ? b : a), view.tiers[0])?.id;

  return (
    <div className="flex flex-col gap-6 pt-1">
      <p className="text-[15px] leading-relaxed m-0" style={{ color: 'var(--theme-text-muted)' }}>
        <strong style={{ color: 'var(--theme-text)' }}>{view.requestsRemaining}</strong> request{view.requestsRemaining === 1 ? '' : 's'} left.
        Pick a pack. It is a one-time purchase paid directly to Colabonate: no balance to top up, no subscription, and credits never expire.
      </p>

      <div className="flex flex-col gap-3.5">
        {view.tiers.map((tier, i) => (
          <PackCard
            key={tier.id}
            index={i}
            value={tier.requests}
            unit="requests"
            badge={tier.id === bestId ? 'Best value' : i === 1 ? 'Popular' : null}
            price={<SatsAmount sats={tier.priceSats} size="md" />}
            caption={`${Math.round(perReq(tier))} sats / request`}
            disabled={busyTier !== null}
            onClick={() => void buy(tier)}
          />
        ))}
      </div>

      {guest && (
        <p
          className="text-[14px] leading-relaxed m-0 rounded-xl px-4 py-3"
          style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}
        >
          No account needed. Credits are tied to this browser and cannot be recovered if you clear its data.
        </p>
      )}

      {pending && (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] leading-relaxed m-0" style={{ color: 'var(--theme-text-muted)' }}>
            Pay this invoice with any Lightning wallet, then paste the payment preimage to unlock your credits.
          </p>
          <TextField label="Lightning invoice" value={pending.invoice} slotProps={{ input: { readOnly: true } }} multiline maxRows={3} />
          <TextField label="Payment preimage" value={preimage} onChange={(e) => setPreimage(e.target.value.trim())} />
          <div>
            <Button
              variant="contained"
              disabled={!preimage}
              onClick={() => void confirm(pending.purchaseId, preimage)}
              sx={{ fontWeight: 700, borderRadius: '10px', px: 3, py: 1 }}
            >
              Confirm payment
            </Button>
          </div>
        </div>
      )}

      {message && (
        <span className="text-[14px] font-semibold" style={{ color: message.kind === 'ok' ? 'var(--color-status-success)' : 'var(--color-status-error)' }}>
          {message.text}
        </span>
      )}

      {active && (
        <div className="flex items-center justify-center gap-2">
          <CircularProgress size={16} />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--theme-text-muted)' }}>Processing...</span>
        </div>
      )}

      {onClose && (
        <div className="flex items-center justify-end pt-1">
          <Button
            variant="outlined"
            onClick={onClose}
            sx={{
              fontWeight: 600,
              borderRadius: '10px',
              px: 3,
              py: 1,
              color: 'var(--theme-text-muted)',
              borderColor: 'var(--theme-border)',
              '&:hover': { borderColor: 'var(--theme-text-muted)' },
            }}
          >
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
