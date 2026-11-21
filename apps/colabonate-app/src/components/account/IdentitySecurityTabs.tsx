import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Tabs, Tab, Typography, Alert, Divider } from '@mui/material'
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined'
import StairsIcon from '@mui/icons-material/Stairs'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { KeyManagementPanel } from './KeyManagementPanel'
import { WorkspaceChatKeyPanel } from './WorkspaceChatKeyPanel'
import { IdentityLevelSection } from './IdentityLevelSection'
import { BunkerConnectionPanel } from '../settings/BunkerConnectionPanel'
import { WalletStrategySection } from '../wallet/WalletStrategySection'
import { getIdentityKeyType } from '../../lib/nostr-identity'
import type { IdentityData } from '../../types/identity'

/**
 * ADR-195 §3.4 — the "Identity & Security" sub-tab group on the Account page.
 *
 *   Tab 1 — Identity Level      (the L0–L3 trust ladder)               ★ default
 *   Tab 2 — Keys & Backup       (npub, status, custody, nsec export)
 *   Tab 3 — Signer / Bunker     (NIP-46 connect, upgrade path)
 *   Tab 4 — Wallet Custody      (custodial/non-custodial strategy)
 *
 * Styled to match `Settings.tsx` (same MUI Tabs + token colours).
 */

const C = {
  surface: 'var(--theme-surface)',
  text: 'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border: 'var(--theme-border)',
} as const

interface IdentitySecurityTabsProps {
  pubkey: string
  identityData: IdentityData | null
  onIdentityChanged: (data: IdentityData) => void
}

export function IdentitySecurityTabs({ pubkey, identityData, onIdentityChanged }: IdentitySecurityTabsProps) {
  const [tab, setTab] = useState(0)
  const keyType = getIdentityKeyType()

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          minHeight: 40,
          borderBottom: `1px solid ${C.border}`,
          '& .MuiTab-root': {
            textTransform: 'none',
            minHeight: 40,
            fontWeight: 600,
            color: C.textMuted,
            '&.Mui-selected': { color: 'var(--color-primary-50)' },
          },
          '& .MuiTabs-indicator': { backgroundColor: 'var(--color-primary-50)' },
        }}
      >
        <Tab icon={<StairsIcon />} iconPosition="start" label="Identity Level" />
        <Tab icon={<KeyOutlinedIcon />} iconPosition="start" label="Keys & Backup" />
        <Tab icon={<HubOutlinedIcon />} iconPosition="start" label="Signer / Bunker" />
        <Tab icon={<AccountBalanceWalletOutlinedIcon />} iconPosition="start" label="Wallet Custody" />
      </Tabs>

      <Box sx={{ pt: 3 }}>
        {tab === 0 && (
          <IdentityLevelSection
            identityData={identityData}
            pubkey={pubkey}
            onIdentityChanged={onIdentityChanged}
          />
        )}

        {tab === 1 && (
          <Box className="flex flex-col gap-5">
            <KeyManagementPanel />
            <Divider sx={{ borderColor: C.border }} />
            <WorkspaceChatKeyPanel />
          </Box>
        )}

        {tab === 2 && (
          <Box className="flex flex-col gap-4">
            <Typography variant="body2" sx={{ color: C.textMuted }}>
              Upgrade to a real, portable Nostr identity. Your private key stays in the signer you
              choose. Colabonate never holds it (ADR-141).
            </Typography>

            {keyType !== 'bunker' && (
              <Alert severity="info" icon={<SwapHorizIcon fontSize="inherit" />} sx={{ bgcolor: 'transparent' }}>
                <Typography variant="caption">
                  Connecting a new signer creates a <strong>new public key</strong>, a new
                  identity. Reputation does not transfer automatically. Migrate early, before you
                  build reputation.
                </Typography>
              </Alert>
            )}

            <BunkerConnectionPanel />
          </Box>
        )}

        {tab === 3 && (
          <Box className="flex flex-col gap-4">
            <Alert severity="info" sx={{ bgcolor: 'transparent' }}>
              <Typography variant="caption">
                Layer 2: your <strong>payment wallet</strong> is separate from your identity key.
                Colabonate runs Direct-Pay and holds no funds: a buyer pays your own Lightning
                address, NWC wallet, Alby account, or Cashu wallet directly. Non-custodial
                (WebLN / NWC / Alby / Cashu) keeps the key with you.
              </Typography>
            </Alert>
            <WalletStrategySection pubkey={pubkey} />
            <Box>
              <Link
                to="/settings#wallet"
                className="inline-flex items-center gap-1 text-[13px] font-semibold"
                style={{ color: 'var(--color-primary-50)' }}
              >
                <OpenInNewIcon sx={{ fontSize: 15 }} />
                Open all wallet settings
              </Link>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}
