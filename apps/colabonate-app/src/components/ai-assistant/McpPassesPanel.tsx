// ADR-384 D11 / ADR-410: buy the MCP access pass, paid directly to Colabonate.
// Since ADR-410 the ladder is a single lifetime tier at the lowest tier price:
// one one-time payment, never expires, framed as supporting the development of
// Colabonate and the open protocol (small heart beside the price). Same
// non-custodial flow and look as the AI credit packs: DEMO confirm on the
// closed beta, otherwise pay the invoice with the connected wallet (NWC /
// Alby / WebLN) or any Lightning wallet and paste the preimage.
import { useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import { Heart } from 'lucide-react';
import { apiCall } from '../../lib/api';
import { usePayment } from '../../hooks/usePayment';
import { SatsAmount } from '../currency/SatsAmount';
import { AI_ACCENT_YELLOW } from '../home/AiAccentDivider';
import { PackCard } from './PackCard';

export interface McpPassTier { id: string; hours: number | null; priceSats: number }

interface Pending { purchaseId: string; invoice: string }

export function McpPassesPanel({
  tiers,
  onPurchased,
  onClose,
  autoBuyTierId,
  lifetimeActive = false,
}: {
  tiers: McpPassTier[];
  onPurchased?: () => void;
  onClose?: () => void;
  autoBuyTierId?: string;
  lifetimeActive?: boolean;
}) {
  const { payInvoice } = usePayment();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [preimage, setPreimage] = useState('');

  const confirm = async (id: string, pre?: string) => {
    try {
      await apiCall(`/api/mcp/passes/${id}/confirm`, { method: 'POST', body: JSON.stringify(pre ? { preimage: pre } : {}) });
      setMessage({ kind: 'ok', text: 'Pass active. You can connect your agent now.' });
      setPending(null);
      setPreimage('');
      onPurchased?.();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Confirmation failed' });
    }
  };

  const buy = async (tier: McpPassTier) => {
    if (busy) return;
    setBusy(tier.id);
    setMessage(null);
    setPending(null);
    try {
      const res = await apiCall('/api/mcp/passes/purchase', { method: 'POST', body: JSON.stringify({ tier: tier.id }) });
      const p = (await res.json()) as { id: string; rail: 'LN' | 'DEMO'; invoice: string | null; paymentHash: string | null };
      if (p.rail === 'DEMO') {
        await confirm(p.id);
        return;
      }
      if (!p.invoice || !p.paymentHash) {
        setMessage({ kind: 'error', text: 'Invoice missing' });
        return;
      }
      const paid = await payInvoice({ invoice: p.invoice, paymentHash: p.paymentHash });
      if (paid.ok && paid.preimage) {
        await confirm(p.id, paid.preimage);
      } else {
        // No wallet-provided preimage (or no wallet): manual pay + preimage paste.
        if (!paid.ok && paid.error) setMessage({ kind: 'error', text: paid.error });
        setPending({ purchaseId: p.id, invoice: p.invoice });
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Purchase failed';
      setMessage({
        kind: 'error',
        text: text === 'PLATFORM_PAYMENT_NOT_CONFIGURED' ? 'Buying passes is not available on this deployment yet.' : text,
      });
    } finally {
      setBusy(null);
    }
  };

  // A tier picked elsewhere on the page starts its purchase once, right away.
  const autoBought = useRef(false);
  useEffect(() => {
    if (!autoBuyTierId || autoBought.current) return;
    const tier = tiers.find((t) => t.id === autoBuyTierId);
    if (!tier) return;
    autoBought.current = true;
    void buy(tier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBuyTierId, tiers]);

  /** Dated tiers (env-override ladders for self-hosters) keep the day math. */
  const daysOf = (t: McpPassTier): number => Math.max(1, Math.round((t.hours ?? 0) / 24));
  const allLifetime = tiers.length > 0 && tiers.every((t) => t.hours === null);

  return (
    <div className="flex flex-col gap-6 pt-1">
      <p className="text-[15px] leading-relaxed m-0" style={{ color: 'var(--theme-text-muted)' }}>
        {allLifetime
          ? 'One payment, forever. The pass never expires, has no subscription and no balance to top up — and it supports the development of Colabonate and the open protocol.'
          : 'Pick how long your agent may stay connected. A pass is a one-time purchase paid directly to Colabonate: no subscription, no balance. Buying while a pass is active adds the time on top.'}
      </p>

      {lifetimeActive || tiers.length === 0 ? (
        <p className="text-[15px] font-semibold m-0" style={{ color: 'var(--color-status-success)' }}>
          You already have lifetime MCP access. Nothing more to buy — connect your agent any time.
        </p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {tiers.map((t, i) => (
            <PackCard
              key={t.id}
              index={i}
              value={t.hours === null ? '∞' : daysOf(t)}
              unit={t.hours === null ? 'lifetime' : daysOf(t) === 1 ? 'day' : 'days'}
              badge={null}
              price={
                <span className="inline-flex items-center gap-1.5">
                  {t.hours === null && <Heart size={13} className="fill-current" style={{ color: AI_ACCENT_YELLOW }} />}
                  <SatsAmount sats={t.priceSats} size="md" />
                </span>
              }
              caption={t.hours === null ? 'one-time · never expires' : `${Math.round(t.priceSats / daysOf(t))} sats / day`}
              disabled={busy !== null}
              onClick={() => void buy(t)}
            />
          ))}
        </div>
      )}

      {pending && (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] leading-relaxed m-0" style={{ color: 'var(--theme-text-muted)' }}>
            Pay this invoice with any Lightning wallet, then paste the payment preimage to activate your pass.
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

      {busy && (
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
            sx={{ fontWeight: 600, borderRadius: '10px', px: 3, py: 1, color: 'var(--theme-text-muted)', borderColor: 'var(--theme-border)', '&:hover': { borderColor: 'var(--theme-text-muted)' } }}
          >
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
