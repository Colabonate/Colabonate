import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Alert, Box, Button, CircularProgress, IconButton, Typography } from '@mui/material'
import HandshakeIcon from '@mui/icons-material/Handshake'
import RefreshIcon from '@mui/icons-material/Refresh'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import { PageCard, PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { TradeStateBadge } from '../../components/trade/TradeStateBadge'
import { TradeTimeline } from '../../components/trade/TradeTimeline'
import { TradeChat } from '../../components/trade/TradeChat'
import { TradeActionBar } from '../../components/trade/TradeActionBar'
import { PartyCard } from '../../components/trade/PartyCard'
import { ProvenanceChip } from '../../components/trust/ProvenanceChip'
import { CanisterTrustPanel } from '../../components/trust/CanisterTrustPanel'
import { SatsAmount } from '../../components/currency/SatsAmount'
import { FiatHint } from '../../components/currency/FiatHint'
import { verifyCanister } from '../../lib/icp-verification'
import { fetchEscrowTrade, nanosToDate, shortPubkey } from '../../lib/escrow-trade'

/**
 * /trade/:tradeId — Escrow cockpit (ADR-362 / ADR-355 D4). Visual hierarchy:
 *  1. Partners first — two cards (buyer / seller) with the same banner + avatar
 *     + identity pattern as the public profile, so who is involved is legible at
 *     a glance. A dispute freezes the identity/contact snapshot.
 *  2. A responsive two-column grid (lg+): main column = state + action +
 *     timeline + messages; rail = terms + funding + trust + interop.
 *  3. Terms render as a readable key/value spec sheet; the timeline explains
 *     what each event meant and which state it produced.
 */

export function TradeCockpit() {
  const { tradeId } = useParams<{ tradeId: string }>()
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const viewerPubkey = localStorage.getItem('pubkey')

  const detailQuery = useQuery({
    queryKey: ['escrow-trade', tradeId],
    queryFn: () => fetchEscrowTrade(tradeId as string),
    enabled: !!tradeId,
  })

  const trade = detailQuery.data?.trade
  const canisterId = trade?.canisterId

  // Trust is an independent axis (ADR-356); a green trade badge must never
  // imply a verified canister, so the panel runs its own browser-side L1 check.
  const trustQuery = useQuery({
    queryKey: ['escrow-trade-trust', canisterId],
    queryFn: () => verifyCanister(canisterId as string),
    enabled: !!canisterId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const onCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch {
      // clipboard may be unavailable; ignore
    }
  }

  if (detailQuery.isLoading) {
    return (
      <PageContainer>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={24} />
        </Box>
      </PageContainer>
    )
  }

  if (!trade) {
    return (
      <PageContainer>
        <PageCard>
          <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
            Trade not found.
          </Typography>
        </PageCard>
      </PageContainer>
    )
  }

  const stateProvenance = detailQuery.data?.canisterState ? 'observation' : 'app-record'
  const drift = detailQuery.data?.drift ?? false
  const isDisputed = trade.state === 'DISPUTED' || trade.state === 'DISPUTE_SETTLED'

  return (
    <>
      <Seo title={`Escrow trade #${trade.canisterTradeId}`} description="Escrow trade cockpit — partners, state, terms, timeline and verifiable canister trust." path={`/trade/${trade.id}`} />
      <PageContainer size="wide">
        <PageHeader
          icon={<HandshakeIcon sx={{ fontSize: 22 }} />}
          title={`Escrow trade #${trade.canisterTradeId}`}
          subtitle="Self custody Bitcoin escrow. The canister is the source of truth and this mirror announces its own drift."
          actions={
            <Button
              size="small"
              startIcon={<RefreshIcon sx={{ fontSize: 16 }} />}
              onClick={() => void detailQuery.refetch()}
              disabled={detailQuery.isFetching}
              sx={{ textTransform: 'none' }}
            >
              Refresh
            </Button>
          }
        />

        {/* 1 ── Partners (two cards, buyer left / seller right) ────────────── */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <PartyCard
            role="buyer"
            pubkey={trade.buyerPubkey}
            address={trade.buyerRefundAddress}
            snapshot={trade.buyerIdentitySnapshot ?? null}
            isYou={viewerPubkey === trade.buyerPubkey}
            frozen={isDisputed}
          />
          <PartyCard
            role="seller"
            pubkey={trade.sellerPubkey}
            address={trade.sellerPayoutAddress}
            snapshot={trade.sellerIdentitySnapshot ?? null}
            isYou={viewerPubkey === trade.sellerPubkey}
            frozen={isDisputed}
          />
        </Box>

        {/* 2 ── Responsive grid: main column + rail ───────────────────────── */}
        <Box sx={{ mt: 2, display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 2, alignItems: 'flex-start' }}>
          {/* Main column */}
          <Box sx={{ flex: { lg: '0 0 calc(66.66% - 8px)' }, width: { xs: '100%', lg: 'auto' }, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* State + provenance + drift */}
            <PageCard>
              <SectionTitle>State</SectionTitle>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <TradeStateBadge state={trade.state} />
                  <ProvenanceChip provenance={stateProvenance} />
                </Box>
                <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
                  {stateProvenance === 'observation'
                    ? 'Fresh canister read. The funding address is consensus certified (FU-619).'
                    : 'Mirror value. The canister was not read this request.'}
                </Typography>
                {trade.settledBuyerBps !== null && trade.settledSellerBps !== null && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: 1.5, bgcolor: 'rgba(72,187,120,0.12)' }}>
                    <CheckCircleIcon sx={{ fontSize: 16, color: 'var(--color-status-success)' }} />
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--color-status-success)' }}>
                      Split {trade.settledBuyerBps / 100}% buyer / {trade.settledSellerBps / 100}% seller
                    </Typography>
                  </Box>
                )}
                {drift && (
                  <Alert severity="warning" sx={{ borderRadius: 2 }}>
                    The mirror and the canister disagree. The canister value wins. Refresh to update.
                  </Alert>
                )}
              </Box>
            </PageCard>

            {/* Action bar (ADR-357 D6) */}
            <PageCard>
              <SectionTitle>Actions</SectionTitle>
              <TradeActionBar
                trade={trade}
                canisterState={detailQuery.data?.canisterState ?? null}
                viewerPubkey={viewerPubkey}
                onChanged={() => void detailQuery.refetch()}
              />
            </PageCard>

            {/* Timeline */}
            <PageCard>
              <SectionTitle>Timeline</SectionTitle>
              <TradeTimeline events={detailQuery.data?.events ?? []} />
            </PageCard>

            {/* Trade-scoped messaging (ADR-358) */}
            <PageCard>
              <SectionTitle>Messages</SectionTitle>
              <TradeChat tradeRef={trade.canisterTradeId} buyerPubkey={trade.buyerPubkey} sellerPubkey={trade.sellerPubkey} />
            </PageCard>
          </Box>

          {/* Rail column */}
          <Box sx={{ flex: { lg: '1 1 calc(33.33% - 8px)' }, width: { xs: '100%', lg: 'auto' }, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Terms — key/value spec sheet */}
            <PageCard>
              <SectionTitle>Terms</SectionTitle>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <KeyValue label="Amount" value={<><SatsAmount sats={trade.expectedAmountSats} showUnit /> <FiatHint sats={trade.expectedAmountSats} /></>} />
                <KeyValue label="Milestones" value={<MilestoneList milestones={trade.milestones} />} />
                <KeyValue label="Timeout" value={trade.timeoutAt ? nanosToDate(trade.timeoutAt).toLocaleString() : 'None'} />
                <KeyValue
                  label="Terms hash"
                  value={trade.tradeTermsHash ? shortPubkey(trade.tradeTermsHash) : 'None'}
                  mono
                  copyable={trade.tradeTermsHash ?? undefined}
                  copiedKey={copiedKey}
                  copyKey="terms-hash"
                  onCopy={onCopy}
                  last
                />
              </Box>
              <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', mt: 1, display: 'block' }}>
                <ProvenanceChip provenance="app-record" /> Terms are mirrored from the canister and bound to the trade by the signed terms hash. Verify independently before funding.
              </Typography>
            </PageCard>

            {/* Funding address */}
            <PageCard>
              <SectionTitle>Funding address</SectionTitle>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {trade.btcAddress || 'None'}
              </Typography>
              {trade.btcAddress && (
                <Button size="small" startIcon={copiedKey === 'funding' ? <CheckIcon sx={{ fontSize: 16 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />} onClick={() => onCopy(trade.btcAddress, 'funding')} sx={{ textTransform: 'none', mt: 1 }}>
                  {copiedKey === 'funding' ? 'Copied' : 'Copy address'}
                </Button>
              )}
              <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', mt: 1, display: 'block' }}>
                The funding address comes from a consensus certified read (FU-619). Until then funding is testnet only.
              </Typography>
            </PageCard>

            {/* Trust panel (cross-cutting axis) */}
            {canisterId && (
              <CanisterTrustPanel
                canisterId={canisterId}
                loading={trustQuery.isLoading || trustQuery.isFetching}
                outcome={trustQuery.data ?? null}
                onReverify={() => void trustQuery.refetch()}
              />
            )}

            {/* ISO 20022 interop link (ADR-360) */}
            <Button component={Link} to={`/trade/${trade.id}/interop`} size="small" sx={{ textTransform: 'none', alignSelf: 'flex-start' }}>
              ISO 20022 interop →
            </Button>
          </Box>
        </Box>
      </PageContainer>
    </>
  )
}

function MilestoneList({ milestones }: { milestones: { pctBps: number; released: boolean }[] }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end' }}>
      {milestones.map((m, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {m.released
            ? <CheckCircleIcon sx={{ fontSize: 14, color: 'var(--color-status-success)' }} />
            : <RadioButtonUncheckedIcon sx={{ fontSize: 14, color: 'var(--theme-text-muted)' }} />}
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {i + 1}. {m.pctBps / 100}%
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="overline" sx={{ color: 'var(--theme-text-muted)', letterSpacing: '0.08em', display: 'block', mb: 1 }}>
      {children}
    </Typography>
  )
}

function KeyValue({ label, value, mono = false, copyable, copiedKey, copyKey, onCopy, last = false }: {
  label: string
  value: React.ReactNode
  mono?: boolean
  copyable?: string
  copiedKey?: string | null
  copyKey?: string
  onCopy?: (text: string, key: string) => void
  last?: boolean
}) {
  const isCopied = copyKey != null && copiedKey === copyKey
  return (
    <Box sx={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 2,
      py: 1.25,
      borderBottom: last ? 'none' : '1px solid var(--theme-border)',
    }}>
      <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, pt: 0.25, flexShrink: 0, fontSize: 13 }}>
        {label}
      </Typography>
      <Box sx={{ textAlign: 'right', minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {typeof value === 'string' ? (
          <Typography variant="body2" sx={{ fontFamily: mono ? 'monospace' : undefined, wordBreak: mono ? 'break-all' : undefined, fontWeight: mono ? 500 : 600, fontVariantNumeric: mono ? undefined : 'tabular-nums' }}>{value}</Typography>
        ) : (
          value
        )}
        {copyable && onCopy && copyKey && (
          <IconButton size="small" onClick={() => onCopy(copyable, copyKey)} aria-label={`Copy ${label}`} sx={{ p: 0.5, color: isCopied ? 'var(--color-status-success)' : 'var(--theme-text-muted)' }}>
            {isCopied ? <CheckIcon sx={{ fontSize: 14 }} /> : <ContentCopyIcon sx={{ fontSize: 14 }} />}
          </IconButton>
        )}
      </Box>
    </Box>
  )
}
