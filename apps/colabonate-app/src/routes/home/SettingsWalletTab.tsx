import { Wallet, AccountBalanceWallet, Bolt, CheckCircle, WarningAmber } from '@mui/icons-material'
import { Box, List, ListItem, ListItemIcon, ListItemSecondaryAction, ListItemText, Switch, MenuItem, Select, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePref } from '../../utils/userPreferences'
import { WalletStrategySection } from '../../components/wallet/WalletStrategySection'
import { LnAddressSettings } from '../../components/wallet/LnAddressSettings'
import { walletProviderLabel } from '../../lib/walletProviderLabels'
import { WalletConnectFlow } from '../../components/wallet/WalletConnectFlow'
import { isCashuEnabled, getMintTrust } from '../../lib/cashu'
import { useCashu } from '../../contexts/CashuContext'
import { useWallet } from '../../contexts/WalletContext'
import { useCurrency } from '../../contexts/CurrencyContext'
import { ConnectNWCModal } from '../../components/wallet/ConnectNWCModal'
import { SUPPORTED_CURRENCY_LIST } from '../../config/currencies'
import { apiCall } from '../../lib/api'

const C = {
  surface: 'var(--theme-surface)',
  bg: 'var(--theme-bg)',
  text: 'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border: 'var(--theme-border)',
} as const

// Section rhythm uses the MUI theme spacing scale (4px unit) — 24/32/40px
// between sections, so the wallet tab breathes instead of packing sections together.
const SECTION_GAP = { xs: 6, md: 8, lg: 10 }

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Box sx={{ mb: { xs: 3, md: 4 } }}>
      <Typography
        variant="overline"
        sx={{ color: C.textMuted, display: 'block', lineHeight: 1.4 }}
      >
        {title}
      </Typography>
      {subtitle && (
        <Typography
          variant="caption"
          sx={{ color: C.textMuted, display: 'block', lineHeight: 1.5, mt: 3 }}
        >
          {subtitle}
        </Typography>
      )}
    </Box>
  )
}

export function SettingsWalletTab() {
  const { wallet, wallets: connectedWallets, switchActiveWallet, disconnectNWC, connectWebLN, disconnectWallet } = useWallet()
  // ADR-298: an ALBY_OAUTH Wallet row is created automatically at Alby login
  // (auth-alby.ts), not via a connect action on this page — so this section
  // is status-only, no connect/disconnect control here.
  const albyOauthWallet = connectedWallets.find(w => w.provider === 'ALBY_OAUTH')
  const [nwcModalOpen, setNwcModalOpen] = useState(false)
  const [weblnConnecting, setWeblnConnecting] = useState(false)
  const pubkey = localStorage.getItem('pubkey')
  const { currency, setCurrency, rateStale } = useCurrency()
  const [autoRefresh, setAutoRefresh] = usePref('autoRefreshBalance', true)
  const [cashuOptIn, setCashuOptIn] = usePref('cashuEnabled', false)
  const cashuAvailable = isCashuEnabled()
  const cashuWallet = useCashu()
  const [cashuReceiveEnabled, setCashuReceiveEnabled] = useState(false)
  const [cashuReceiveMint, setCashuReceiveMint] = useState<string>('')
  const [cashuReceiveSaving, setCashuReceiveSaving] = useState(false)
  const queryClient = useQueryClient()

  // FU-801: same check the offer-publish gate runs server-side
  // (hasSellerPaymentMethodConfigured) — a short poll plus an invalidation on
  // every connected-wallet change keeps this in sync without threading a
  // callback through every connect/disconnect action on this page.
  const { data: payoutReadiness } = useQuery({
    queryKey: ['wallet-payout-readiness'],
    queryFn: async () => {
      const res = await apiCall('/api/wallet/payout-readiness')
      if (!res.ok) throw new Error('Failed to check payout readiness')
      return (await res.json()) as { ready: boolean }
    },
    enabled: Boolean(pubkey),
    refetchInterval: 15000,
  })

  useEffect(() => {
    if (pubkey) void queryClient.invalidateQueries({ queryKey: ['wallet-payout-readiness'] })
  }, [connectedWallets, pubkey, queryClient])

  // No GET endpoint for the saved preference (ADR-253 keeps this minimal) —
  // approximate the toggle's initial state from the wallet peer list, which
  // is already loaded here. Re-saving on toggle is idempotent either way.
  useEffect(() => {
    if (connectedWallets.some(w => w.provider === 'CASHU')) {
      setCashuReceiveEnabled(true)
    }
  }, [connectedWallets])

  useEffect(() => {
    if (!cashuReceiveMint && cashuWallet.mints.length > 0) {
      setCashuReceiveMint(cashuWallet.mints[0])
    }
  }, [cashuWallet.mints, cashuReceiveMint])

  async function handleCashuReceiveToggle(next: boolean) {
    setCashuReceiveSaving(true)
    try {
      if (next) {
        if (!cashuWallet.walletPubkey || !cashuReceiveMint) return
        await apiCall('/api/wallet/cashu/receive-preference', {
          method: 'POST',
          body: JSON.stringify({ pubkey: cashuWallet.walletPubkey, mintUrl: cashuReceiveMint }),
        })
      } else {
        await apiCall('/api/wallet/cashu/receive-preference', { method: 'DELETE' })
      }
      setCashuReceiveEnabled(next)
      void queryClient.invalidateQueries({ queryKey: ['wallet-payout-readiness'] })
    } finally {
      setCashuReceiveSaving(false)
    }
  }

  async function handleConnectWebLN() {
    setWeblnConnecting(true)
    try {
      await connectWebLN()
    } finally {
      setWeblnConnecting(false)
    }
  }

  const switchSx = {
    '& .MuiSwitch-switchBase.Mui-checked': { color: 'var(--color-primary-50)' },
    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: 'var(--color-primary-50)' },
    '& .MuiSwitch-track': { borderRadius: 13 },
    '& .MuiSwitch-thumb': { boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
  }

  return (
    <Box>
      <SectionHeader title="Wallet" subtitle="Lightning wallet preferences" />

      {/* FU-801: WebLN/LNBits connections show as "Connected" below but are
          NOT a payout rail an offer's publish gate accepts (only a routable
          Lightning Address, NWC, an active Alby OAuth wallet, or Cashu
          count) — this banner states plainly whether publishing paid offers
          will actually work right now, instead of letting sellers discover
          the gap at the final "Publish Offer" step. */}
      {pubkey && payoutReadiness && (
        <Box
          sx={{
            mb: SECTION_GAP,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.5,
            p: 2.5,
            borderRadius: 2,
            border: '1px solid',
            borderColor: payoutReadiness.ready ? 'var(--color-status-success)' : 'var(--color-status-warning)',
            bgcolor: payoutReadiness.ready ? 'var(--color-status-success-bg)' : 'var(--color-status-warning-bg)',
          }}
        >
          {payoutReadiness.ready ? (
            <CheckCircle sx={{ color: 'var(--color-status-success)', mt: 0.25 }} />
          ) : (
            <WarningAmber sx={{ color: 'var(--color-status-warning)', mt: 0.25 }} />
          )}
          <Box>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: payoutReadiness.ready ? 'var(--color-status-success)' : 'var(--color-status-warning)' }}>
              {payoutReadiness.ready ? 'Ready to publish paid offers' : 'No payout rail configured yet'}
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: C.textMuted, mt: 0.5 }}>
              {payoutReadiness.ready
                ? 'Buyers can pay you directly — no platform in the middle.'
                : 'A Lightning Address, Nostr Wallet Connect, Alby, or Cashu below is required before you can publish an ACTIVE offer. WebLN and other spend-only wallets do not count — drafts still save fine.'}
            </Typography>
          </Box>
        </Box>
      )}

      {pubkey && (
        <Box sx={{ mb: SECTION_GAP }}>
          <WalletStrategySection pubkey={pubkey} />
        </Box>
      )}

      {pubkey && (
        <Box sx={{ mb: SECTION_GAP }}>
          <SectionHeader
            title="Your Lightning Address"
            subtitle="A public address others can pay — minted on your own wallet, never held by Colabonate"
          />
          <LnAddressSettings />
        </Box>
      )}

      <Box sx={{ mb: SECTION_GAP }}>
        <SectionHeader title="Currency Display" subtitle="Primary currency for fiat equivalent (saved to your account)" />
        <Box
          component="div"
          sx={{
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          {SUPPORTED_CURRENCY_LIST.map(cur => (
            <Box
              key={cur.code}
              component="button"
              onClick={() => setCurrency(cur.code)}
              sx={{
                px: 2,
                py: 1,
                borderRadius: 2,
                border: '1px solid',
                borderColor: currency === cur.code ? 'var(--color-primary-50)' : C.border,
                bgcolor: currency === cur.code ? 'rgba(232,69,65,0.08)' : 'transparent',
                color: currency === cur.code ? 'var(--color-primary-50)' : C.textMuted,
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {cur.code} {cur.symbol}
            </Box>
          ))}
        </Box>
        <Box component="span" sx={{ display: 'block', mt: 1, fontSize: '0.7rem', color: C.textMuted }}>
          {rateStale
            ? 'Exchange rate may be stale — values update shortly.'
            : 'Sats remain the unit of account; this only selects the fiat shown next to them.'}
        </Box>
      </Box>

      <Box sx={{ mt: SECTION_GAP }}>
        <SectionHeader title="Balance Settings" />
        <Box
          component="div"
          sx={{ borderRadius: 2, border: '1px solid', borderColor: C.border, bgcolor: C.surface }}
        >
          <List disablePadding>
            <ListItem sx={{ py: 1.75, px: 2.5 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Wallet sx={{ color: C.textMuted }} />
              </ListItemIcon>
              <ListItemText
                primary={<Box component="span" sx={{ fontSize: '0.875rem', fontWeight: 600, color: C.text }}>Auto-refresh balance</Box>}
                secondary={<Box component="span" sx={{ fontSize: '0.75rem', color: C.textMuted }}>Update balance automatically</Box>}
              />
              <ListItemSecondaryAction>
                <Switch
                  checked={autoRefresh}
                  onChange={e => setAutoRefresh(e.target.checked)}
                  size="small"
                  sx={switchSx}
                />
              </ListItemSecondaryAction>
            </ListItem>
          </List>
        </Box>
      </Box>

      {cashuAvailable && (
        <Box sx={{ mt: SECTION_GAP }}>
          <SectionHeader title="Non-custodial eCash (Cashu)" subtitle="NIP-60 / NIP-61 — bearer tokens, client-side wallet" />
          <Box
            component="div"
            sx={{ borderRadius: 2, border: '1px solid', borderColor: C.border, bgcolor: C.surface }}
          >
            <List disablePadding>
              <ListItem sx={{ py: 1.75, px: 2.5 }}>
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <AccountBalanceWallet sx={{ color: C.textMuted }} />
                </ListItemIcon>
                <ListItemText
                  primary={<Box component="span" sx={{ fontSize: '0.875rem', fontWeight: 600, color: C.text }}>Enable eCash wallet</Box>}
                  secondary={
                    <Box component="span" sx={{ fontSize: '0.75rem', color: C.textMuted }}>
                      Off by default. You hold the proofs; losing your wallet key or a mint going insolvent means losing funds.
                    </Box>
                  }
                />
                <ListItemSecondaryAction>
                  <Switch
                    checked={cashuOptIn}
                    onChange={e => setCashuOptIn(e.target.checked)}
                    size="small"
                    sx={switchSx}
                  />
                </ListItemSecondaryAction>
              </ListItem>
            </List>
          </Box>
        </Box>
      )}

      {cashuAvailable && cashuOptIn && (
        <Box sx={{ mt: SECTION_GAP }}>
          <SectionHeader
            title="Receive via Cashu"
            subtitle="ADR-253/298: buyers can pay your listings with a P2PK-locked eCash token when no Lightning address, NWC, or Alby OAuth wallet is set"
          />
          <Box
            component="div"
            sx={{ borderRadius: 2, border: '1px solid', borderColor: C.border, bgcolor: C.surface, p: 2.5 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: cashuReceiveEnabled ? 1.5 : 0 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                <Box component="span" sx={{ fontSize: '0.875rem', fontWeight: 600, color: C.text }}>
                  Accept Cashu for sales
                </Box>
                <Box component="span" sx={{ fontSize: '0.75rem', color: C.textMuted }}>
                  {cashuWallet.walletPubkey
                    ? `Locks to your wallet pubkey ${cashuWallet.walletPubkey.slice(0, 12)}…`
                    : 'Wallet is still initialising…'}
                </Box>
              </Box>
              <Switch
                checked={cashuReceiveEnabled}
                disabled={cashuReceiveSaving || !cashuWallet.walletPubkey}
                onChange={e => void handleCashuReceiveToggle(e.target.checked)}
                size="small"
                sx={switchSx}
              />
            </Box>
            {cashuReceiveEnabled && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Box component="span" sx={{ fontSize: '0.7rem', color: C.textMuted }}>
                  Receiving mint
                </Box>
                <Select
                  size="small"
                  value={cashuReceiveMint}
                  onChange={e => {
                    const mint = e.target.value
                    setCashuReceiveMint(mint)
                    void handleCashuReceiveToggle(true)
                  }}
                  sx={{ fontSize: '0.8rem' }}
                >
                  {cashuWallet.mints.map(m => (
                    <MenuItem key={m} value={m} sx={{ fontSize: '0.8rem' }}>
                      {m}
                    </MenuItem>
                  ))}
                </Select>
                {/* FU-39: say the mint's trust level explicitly instead of leaving it ambiguous. */}
                <Box component="span" sx={{ fontSize: '0.7rem', color: getMintTrust(cashuReceiveMint) === 'vetted' ? C.textMuted : 'var(--color-status-warning)' }}>
                  {getMintTrust(cashuReceiveMint) === 'vetted'
                    ? 'Colabonate-recommended mint (mint.minibits.cash) — no audited proof-of-reserves exists yet for any Cashu mint, ecosystem-wide.'
                    : getMintTrust(cashuReceiveMint) === 'test'
                      ? 'This is a public TEST mint — tokens have no real value. Add your own mint below before accepting real payments.'
                      : 'Unvetted third-party mint — Colabonate does not vouch for its solvency.'}
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      )}

      <Box sx={{ mt: SECTION_GAP }}>
        <SectionHeader title="WebLN Wallet" subtitle="Non-custodial Lightning via a browser extension" />
        <WalletConnectFlow
          isConnecting={weblnConnecting}
          isConnected={wallet?.provider === 'WEBLN'}
          onConnect={handleConnectWebLN}
          onDisconnect={disconnectWallet}
        />
        <Typography sx={{ fontSize: '0.7rem', color: C.textMuted, mt: 1 }}>
          Spend-wallet only — pays invoices at checkout, but can't receive an offer's payout (it needs your extension open to generate an invoice, which a buyer's checkout can't trigger). Use a Lightning Address, NWC, Alby, or Cashu below to sell.
        </Typography>
      </Box>

      <Box sx={{ mt: SECTION_GAP }}>
        <SectionHeader title="Nostr Wallet (Advanced)" subtitle="Non-custodial Lightning via Nostr Wallet Connect (NIP-47)" />
        <Box
          component="div"
          sx={{ borderRadius: 2, border: '1px solid', borderColor: C.border, bgcolor: C.surface, p: 2.5 }}
        >
          {wallet?.provider === 'NWC' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box component="span" sx={{ fontSize: '0.875rem', fontWeight: 600, color: C.text }}>
                  Connected
                </Box>
                <Box component="span" sx={{ fontSize: '0.75rem', color: C.textMuted, fontFamily: 'monospace' }}>
                  {wallet.nwcWalletPubkey ? `${wallet.nwcWalletPubkey.slice(0, 16)}…` : '—'}
                </Box>
              </Box>
              <Box component="span" sx={{ fontSize: '0.75rem', color: C.textMuted }}>
                Balance: {wallet.balanceSats.toLocaleString()} sats · Payments route through your wallet over Nostr relays.
              </Box>
              <Box
                component="button"
                onClick={() => void disconnectNWC()}
                sx={{
                  alignSelf: 'flex-start',
                  px: 2, py: 1, borderRadius: 1.5,
                  border: '1px solid', borderColor: C.border,
                  color: C.textMuted, fontSize: '0.8rem', fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                Disconnect
              </Box>
            </Box>
          ) : (
            <Box component="span" sx={{ fontSize: '0.75rem', color: C.textMuted, display: 'block', mb: 1.5 }}>
              Connect a Nostr Lightning wallet (Alby, Alby Hub, etc.) to pay invoices at checkout over relays — no browser extension required.
            </Box>
          )}
          <Box
            component="button"
            onClick={() => setNwcModalOpen(true)}
            sx={{
              px: 2, py: 1, borderRadius: 1.5,
              bgcolor: 'var(--color-primary-50)', color: 'white',
              fontSize: '0.8rem', fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s ease',
            }}
          >
            {wallet?.provider === 'NWC' ? 'Reconnect / change wallet' : 'Connect Nostr Wallet'}
          </Box>
        </Box>
      </Box>

      {albyOauthWallet && (
        <Box sx={{ mt: SECTION_GAP }}>
          <SectionHeader title="Alby OAuth Wallet" subtitle="Connected automatically when you signed in with Alby" />
          <Box
            component="div"
            sx={{ borderRadius: 2, border: '1px solid', borderColor: C.border, bgcolor: C.surface, p: 2.5 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Bolt sx={{ fontSize: 18, color: 'var(--color-primary-50)' }} />
                <Box component="span" sx={{ fontSize: '0.875rem', fontWeight: 600, color: C.text }}>
                  Alby Wallet
                </Box>
              </Box>
              <Box
                component="span"
                sx={{
                  px: 1.5, py: 0.5, borderRadius: 1,
                  fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                  bgcolor: albyOauthWallet.status === 'ACTIVE' ? 'var(--color-status-success-bg)' : 'var(--theme-bg-subtle)',
                  color: albyOauthWallet.status === 'ACTIVE' ? 'var(--color-status-success)' : C.textMuted,
                }}
              >
                {albyOauthWallet.status === 'ACTIVE' ? 'Connected' : albyOauthWallet.status}
              </Box>
            </Box>
            <Box component="span" sx={{ fontSize: '0.75rem', color: C.textMuted, display: 'block' }}>
              {albyOauthWallet.status === 'ACTIVE'
                ? 'Non-custodial — Alby generates invoices on your behalf. Used as your Direct-Pay receiving rail (ADR-298) for non-escrow listings when no Lightning address or NWC wallet is configured.'
                : 'Not currently usable as a receiving rail. Sign in with Alby again to reconnect.'}
            </Box>
          </Box>
        </Box>
      )}

      {connectedWallets.length > 1 && (
        <Box sx={{ mt: SECTION_GAP }}>
          <SectionHeader title="Connected Wallets" subtitle="Switch which wallet pays and shows your balance" />
          <Box
            component="div"
            sx={{ borderRadius: 2, border: '1px solid', borderColor: C.border, bgcolor: C.surface }}
          >
            <List disablePadding>
              {connectedWallets.map(cw => {
                // FU-801: mirrors sellerPaymentResolver.ts's gate filter
                // (['NWC','ALBY_OAUTH','CASHU','DEMO']) — Cashu is shown as
                // "if receive is set up" since a Wallet row alone doesn't say
                // whether cashuReceivePubkey/cashuReceiveMintUrl are filled in
                // (see the "Receive via Cashu" section above for that).
                const payoutLabel =
                  cw.provider === 'NWC' || cw.provider === 'DEMO' ? 'Payout rail'
                  : cw.provider === 'ALBY_OAUTH' ? (cw.status === 'ACTIVE' ? 'Payout rail' : 'Spend-only (reconnect to enable)')
                  : cw.provider === 'CASHU' ? 'Payout rail if receive is set up'
                  : 'Spend-only'
                return (
                <ListItem
                  key={cw.id}
                  sx={{ py: 1.75, px: 2.5, cursor: cw.isActive ? 'default' : 'pointer' }}
                  onClick={() => { if (!cw.isActive) void switchActiveWallet(cw.id) }}
                >
                  <ListItemText
                    primary={<Box component="span" sx={{ fontSize: '0.875rem', fontWeight: 600, color: C.text }}>{walletProviderLabel(cw.provider)}</Box>}
                    secondary={
                      <Box component="span" sx={{ fontSize: '0.75rem', color: C.textMuted }}>
                        {cw.mode === 'CUSTODIAL' ? 'Custodial' : 'Non-custodial'} · {payoutLabel}
                      </Box>
                    }
                  />
                  {cw.isActive && (
                    <Box
                      component="span"
                      sx={{
                        px: 1.5, py: 0.5, borderRadius: 1,
                        fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                        bgcolor: 'var(--color-status-success-bg)', color: 'var(--color-status-success)',
                      }}
                    >
                      Active
                    </Box>
                  )}
                </ListItem>
                )
              })}
            </List>
          </Box>
        </Box>
      )}

      <ConnectNWCModal open={nwcModalOpen} onClose={() => setNwcModalOpen(false)} />
    </Box>
  )
}