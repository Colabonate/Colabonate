import { useQuery } from '@tanstack/react-query'
import { EntityProfileHeader } from '@ds/ui'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import BoltIcon from '@mui/icons-material/Bolt'
import LockIcon from '@mui/icons-material/Lock'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import StorefrontIcon from '@mui/icons-material/Storefront'
import { apiCall } from '../../lib/api'
import { shortPubkey, type EscrowIdentitySnapshot } from '../../lib/escrow-trade'

/**
 * PartyCard — one partner card on the escrow cockpit. Renders the same
 * banner + avatar + identity pattern as the public profile (EntityProfileHeader,
 * ADR-367 D1) so a viewer immediately recognizes who is involved. Identity and
 * contact come from the FROZEN snapshot (captured at trade creation and
 * re-captured when a dispute opens); the live Nostr profile is only a fallback
 * for pre-snapshot mirror rows and never overrides a freeze.
 */

interface PartyProfile {
  name: string | null
  picture: string | null
  banner: string | null
  nip05: string | null
  about: string | null
  lnAddress: string | null
}

const EMPTY_PROFILE: PartyProfile = { name: null, picture: null, banner: null, nip05: null, about: null, lnAddress: null }

export function PartyCard({ role, pubkey, address, snapshot, isYou, frozen }: {
  role: 'buyer' | 'seller'
  pubkey: string
  address: string
  snapshot: EscrowIdentitySnapshot | null
  isYou: boolean
  frozen: boolean
}) {
  const { data: profile } = useQuery<PartyProfile>({
    queryKey: ['trade-party-profile', pubkey],
    queryFn: async () => {
      try {
        const res = await apiCall(`/api/user/${pubkey}/profile`)
        const data = (await res.json()) as Partial<PartyProfile> & { error?: string }
        if (data.error) return EMPTY_PROFILE
        return {
          name: data.name ?? null,
          picture: data.picture ?? null,
          banner: data.banner ?? null,
          nip05: data.nip05 ?? null,
          about: data.about ?? null,
          lnAddress: data.lnAddress ?? null,
        }
      } catch {
        return EMPTY_PROFILE
      }
    },
    enabled: !snapshot && /^[0-9a-f]{64}$/i.test(pubkey),
    staleTime: 5 * 60_000,
  })

  const name = snapshot?.name ?? profile?.name ?? null
  const picture = snapshot?.picture ?? profile?.picture ?? null
  const banner = snapshot?.banner ?? profile?.banner ?? null
  const nip05 = snapshot?.nip05 ?? profile?.nip05 ?? null
  const lnAddress = snapshot?.lnAddress ?? profile?.lnAddress ?? null
  const about = snapshot?.about ?? profile?.about ?? null

  const isBuyer = role === 'buyer'
  const accent = isBuyer ? 'var(--color-status-info)' : 'var(--color-status-success)'
  const soft = isBuyer ? 'rgba(99,179,237,0.14)' : 'rgba(72,187,120,0.14)'

  return (
    <EntityProfileHeader
      variant="user"
      bannerUrl={banner ?? undefined}
      avatarUrl={picture ?? undefined}
      title={name || shortPubkey(pubkey)}
      badges={
        <>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] font-semibold" style={{ color: accent, background: soft }}>
            {isBuyer ? <AccountBalanceWalletIcon sx={{ fontSize: 14 }} /> : <StorefrontIcon sx={{ fontSize: 14 }} />}
            {isBuyer ? 'Buyer' : 'Seller'}
          </span>
          {isYou && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-semibold" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}>
              You
            </span>
          )}
          {frozen && snapshot && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] font-semibold" style={{ background: 'rgba(245,166,35,0.16)', color: 'var(--color-status-warning)' }}>
              <LockIcon sx={{ fontSize: 14 }} /> Identity frozen
            </span>
          )}
        </>
      }
      subtitle={
        <div className="flex flex-col gap-2">
          {nip05 && (
            <div className="flex items-center gap-1.5">
              <CheckCircleOutlineIcon sx={{ fontSize: 16, color: 'var(--color-status-success)' }} />
              <span className="text-[14px] text-[var(--theme-text-muted)] break-all">{nip05}</span>
            </div>
          )}
          {lnAddress && (
            <div className="flex items-center gap-1.5">
              <BoltIcon sx={{ fontSize: 16, color: 'var(--color-primary-50)' }} />
              <span className="text-[14px] text-[var(--theme-text-muted)] font-mono break-all">{lnAddress}</span>
            </div>
          )}
          {about && <p className="text-[14px] leading-relaxed text-[var(--theme-text-muted)] m-0">{about}</p>}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[14px] text-[var(--theme-text-muted)]">Pubkey</span>
            <span className="text-[14px] font-mono text-[var(--theme-text)] break-all">{shortPubkey(pubkey)}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[14px] text-[var(--theme-text-muted)]">{isBuyer ? 'Refund address' : 'Payout address'}</span>
            <span className="text-[14px] font-mono text-[var(--theme-text)] break-all">{address || 'None'}</span>
          </div>
          {frozen && snapshot?.capturedAt && (
            <span className="text-[13px] text-[var(--theme-text-muted)]">
              Contact recorded {new Date(snapshot.capturedAt).toLocaleString()}
            </span>
          )}
        </div>
      }
    />
  )
}
