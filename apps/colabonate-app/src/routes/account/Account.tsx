import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@mui/material'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import { cn } from '@ds/utils'
import { PageContainer } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { logout } from '../../lib/logout'
import { IdentityLevelBadge } from '../../components/identity/IdentityLevelBadge'
import { IdentityStatusBadge } from '../../components/identity/IdentityStatusBadge'
import { IdentitySecurityTabs } from '../../components/account/IdentitySecurityTabs'
import { EmailLoginExplainer } from '../../components/account/EmailLoginExplainer'
import { AiRequestsKpi } from '../../components/account/AiRequestsKpi'
import { NewsletterPreference } from '../../components/newsletter/NewsletterPreference'
import { ReputationScore } from '../../components/reputation/ReputationScore'
import { getMyIdentityStatus, isLoggedInViaEmail, getLoggedInEmail, toNpub } from '../../lib/nostr-identity'
import { syncNostrProfile } from '../../lib/nostr'
import type { IdentityData, Review } from '../../types/identity'
import BoltIcon               from '@mui/icons-material/Bolt'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ContentCopyIcon        from '@mui/icons-material/ContentCopy'
import LogoutIcon             from '@mui/icons-material/Logout'
import PersonIcon             from '@mui/icons-material/Person'
import StorefrontIcon         from '@mui/icons-material/Storefront'
import AccountCircleIcon      from '@mui/icons-material/AccountCircle'
import EmojiEventsIcon        from '@mui/icons-material/EmojiEvents'
import ReceiptLongIcon        from '@mui/icons-material/ReceiptLong'
import DeleteIcon             from '@mui/icons-material/Delete'
import WarningIcon            from '@mui/icons-material/Warning'
import RestartAltIcon        from '@mui/icons-material/RestartAlt'
import InfoOutlinedIcon      from '@mui/icons-material/InfoOutlined'
import AccountBalanceIcon    from '@mui/icons-material/AccountBalance'

type DaoRole = 'ADMIN' | 'ARBITRATOR' | 'MEDIATOR'
type DaoMemberStatus = 'PENDING' | 'ACTIVE' | 'REVOKED'

interface DaoMembership {
  role: DaoRole
  status: DaoMemberStatus
  addedAt?: string
  acceptedAt?: string | null
}

const DAO_ROLE_LABELS: Record<DaoRole, string> = {
  ADMIN: 'Admin',
  ARBITRATOR: 'Arbitrator',
  MEDIATOR: 'Mediator',
}

// ─── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6 md:mb-8">
      <h3>{title}</h3>
      {subtitle && (
        <p className="mt-2 text-sm text-(--theme-text-muted) max-w-160">
          {subtitle}
        </p>
      )}
    </div>
  )
}

// ─── Metric Item (label + help link + value + caption) ─────────────────────────
function MetricItem({
  label,
  helpTo,
  helpTitle,
  caption,
  children,
}: {
  label: string
  helpTo?: string
  helpTitle?: string
  caption?: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-1">
        <h5 className="m-0">{label}</h5>
        {helpTo && (
          <Link
            to={helpTo}
            aria-label={helpTitle ?? `Learn about ${label}`}
            title={helpTitle ?? `Learn about ${label}`}
            className="inline-flex items-center justify-center rounded transition-colors hover:text-[var(--color-primary-50)]"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            <InfoOutlinedIcon sx={{ fontSize: 13 }} />
          </Link>
        )}
      </div>
      {children}
      {caption && (
        <p className="mt-1 text-[10px] leading-tight text-[var(--theme-text-muted)]">
          {caption}
        </p>
      )}
    </div>
  )
}

// ─── Detail Row (label + value, responsive stack→inline) ───────────────────────
function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)] sm:w-32 shrink-0">
        {label}
      </dt>
      <dd className="min-w-0 flex items-center gap-1.5 flex-wrap">{children}</dd>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function Account() {
  const navigate = useNavigate()
  const { formatNumber, formatDate } = useTranslation()
  const [lnAddress] = useState<string>(() => { const v = localStorage.getItem('lnAddress') ?? ''; return v === 'undefined' ? '' : v })
  const [evmAddress] = useState<string>(() => { const v = localStorage.getItem('evmAddress') ?? ''; return v === 'undefined' ? '' : v })
  const [pubkey]    = useState<string>(() => localStorage.getItem('pubkey') ?? '')
  const [balance, setBalance] = useState<number | null>(null)
  const [loading, setLoading]             = useState(true)
  const [copied, setCopied]               = useState(false)
  const [stats, setStats] = useState({
    offersCreated:    0,
    ticketsAsBuyer:   0,
    ticketsAsSeller:  0,
    completedTickets: 0,
  })
  const [identityData, setIdentityData]     = useState<IdentityData | null>(null)
  const [receivedReviews, setReceivedReviews] = useState<Review[]>([])
  const [daoMembership, setDaoMembership] = useState<DaoMembership | null>(null)
  const [company, setCompany] = useState<{ name: string; city?: string; isActive?: boolean } | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [onboardingResetDone, setOnboardingResetDone] = useState(false)

  // ── Data fetching ────────────────────────────────────────────────────────────
  const fetchStats = useCallback(async (userPubkey: string) => {
    setLoading(true)
    try {
      const [offersRes, ticketsRes] = await Promise.all([
        apiCall(`/api/offers?creator=${userPubkey}`),
        apiCall(`/api/tickets?pubkey=${userPubkey}`),
      ])
      const offersData  = await offersRes.json()
      const ticketsData = await ticketsRes.json()
      const tickets: { buyerPubkey: string; sellerPubkey: string; status: string }[] = ticketsData.tickets || []
      let ticketsAsBuyer = 0, ticketsAsSeller = 0, completedTickets = 0
      for (const t of tickets) {
        if (t.buyerPubkey === userPubkey) ticketsAsBuyer++
        if (t.sellerPubkey === userPubkey) ticketsAsSeller++
        if (t.status === 'COMPLETED') completedTickets++
      }
      setStats({ offersCreated: offersData.offers?.length || 0, ticketsAsBuyer, ticketsAsSeller, completedTickets })
    } catch {
      console.error('Failed to fetch stats')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchIdentityData = useCallback(async (userPubkey: string) => {
    try {
      const [identRes, reviewsRes, daoMembersRes] = await Promise.all([
        apiCall(`/api/identity/${userPubkey}`),
        apiCall(`/api/identity/reviews/${userPubkey}`),
        apiCall(`/api/dao/foundation/members`).then(r => r.json()).catch(() => ({ members: [] })),
      ])
      const identData = await identRes.json()
      if (!identData.error) setIdentityData(identData)
      const reviewsData = await reviewsRes.json()
      if (reviewsData.reviews) setReceivedReviews(reviewsData.reviews)

      const members: Array<{ pubkey: string; role: DaoRole; status: DaoMemberStatus; addedAt?: string; acceptedAt?: string | null }> =
        daoMembersRes?.members ?? []
      const match =
        members.find(m => m.pubkey === userPubkey && m.status === 'ACTIVE') ??
        members.find(m => m.pubkey === userPubkey && m.status === 'PENDING') ??
        null
      setDaoMembership(match)

      // Auto-load Nostr profile after login: when the account has no avatar or
      // display name yet, pull the Kind 0 metadata from relays (via the user's
      // Nostr key — NIP-07 extension pubkey if available, else the L1-bound
      // nostrPubkey) and persist it server-side (fill-once). Once per browser
      // session — the flag is only set on success, so a failed relay fetch
      // retries on the next mount.
      if (!identData.error && (!identData.picture || !identData.name) && !sessionStorage.getItem('nostr_profile_synced')) {
        void (async () => {
          try {
            let nostrPubkey: string | undefined = identData.nostrPubkey ?? undefined
            const weblnNostr = (window as unknown as { nostr?: { getPublicKey?: () => Promise<string> } }).nostr
            if (weblnNostr?.getPublicKey) {
              try { nostrPubkey = await weblnNostr.getPublicKey() } catch { /* keep DB value */ }
            }
            const synced = await syncNostrProfile(userPubkey, nostrPubkey)
            if (synced && (synced.picture || synced.name)) {
              sessionStorage.setItem('nostr_profile_synced', '1')
              setIdentityData(synced)
            }
          } catch { /* silent — avatar stays generic */ }
        })()
      }
    } catch {
      console.error('Failed to fetch identity data')
    }
  }, [])

  const fetchCompanyData = useCallback(async (userPubkey: string) => {
    try {
      const res = await apiCall(`/api/company/${userPubkey}`)
      const data = await res.json()
      // Only set company if it exists and is active
      if (data.company && data.company.isActive !== false) {
        setCompany({ name: data.company.name, city: data.company.city })
      } else {
        setCompany(null)
      }
    } catch {
      console.error('Failed to fetch company data')
    }
  }, [])

  useEffect(() => {
    if (pubkey) {
      fetchStats(pubkey)
      fetchIdentityData(pubkey)
      fetchCompanyData(pubkey)
    } else {
      setLoading(false)
    }
  }, [fetchStats, fetchIdentityData, pubkey])

  useEffect(() => {
    if (!pubkey || pubkey.includes('test')) return
    const webln = (window as unknown as { webln?: { enable(): Promise<void>; getBalance(): Promise<{ balance: number }> } }).webln
    if (!webln) return
    webln.enable().then(() => webln.getBalance()).then(r => setBalance(r.balance)).catch(() => {/* silent */})
  }, [pubkey])

  async function handleLogout() {
    await logout()
    window.location.href = '/'
  }

  function handleCopyPubkey() {
    if (!npub) return
    navigator.clipboard.writeText(npub)
    setCopied(true)
  }

  async function handleDeleteCompany() {
    if (!pubkey || !company) return
    try {
      const res = await apiCall(`/api/company/${pubkey}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        console.error('Failed to deactivate company:', await res.json())
        return
      }
      // Soft-delete: company is deactivated but data is preserved
      setCompany(null)
      setShowDeleteModal(false)
    } catch (e) {
      console.error('Failed to deactivate company:', e)
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const currentLevel = identityData?.identityLevel ?? 0
  const npub = toNpub(pubkey)
  const identityStatus = getMyIdentityStatus()
  const emailForExplainer = getLoggedInEmail()
  const showEmailExplainer = !!emailForExplainer && isLoggedInViaEmail()
  const totalTickets = stats.ticketsAsBuyer + stats.ticketsAsSeller
  const completionRate = totalTickets > 0 ? Math.round((stats.completedTickets / totalTickets) * 100) : null

  const activityKpis: KPIItem[] = [
    { label: 'Offers',    value: stats.offersCreated,    icon: <StorefrontIcon sx={{ fontSize: 16 }} />,       color: 'var(--color-primary-50)' },
    { label: 'As Buyer',  value: stats.ticketsAsBuyer,   icon: <ReceiptLongIcon sx={{ fontSize: 16 }} />,      color: 'var(--color-status-info)' },
    { label: 'As Seller', value: stats.ticketsAsSeller,  icon: <BoltIcon sx={{ fontSize: 16 }} />,              color: 'var(--color-secondary-50)' },
    { label: 'Completed', value: stats.completedTickets, icon: <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />, color: 'var(--color-status-success)' },
  ]

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <PageContainer size="narrow" spacing="lg">

      <PageHeader
        icon={<AccountCircleIcon fontSize="medium" />}
        title="Account"
        subtitle={lnAddress || undefined}
        onBack={() => navigate('/')}
      />

      {/* Section Container with consistent spacing */}
      <div className="flex flex-col gap-6 md:gap-8">

        {/* ── Account Grid: Profile + Activity + Company ─────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">

          {/* ── Profile Hero (left, spans 2 rows on md+) ─────────────────────────── */}
          <div className="md:row-span-2">
            <div
              className={cn(
                'rounded-2xl',
                'border',
                'border-[var(--theme-border)]',
                'bg-[var(--theme-surface)]',
                'overflow-hidden',
                'h-full',
              )}
            >
              {/* Nostr banner (Kind 0) when synced — otherwise brand gradient strip */}
              {identityData?.banner ? (
                <div
                  className="h-20 md:h-24 bg-cover bg-center"
                  style={{
                    backgroundImage: `url(${identityData.banner})`,
                    backgroundColor: 'var(--theme-bg-subtle)',
                  }}
                />
              ) : (
                <div className="h-1" style={{ background: 'linear-gradient(90deg, var(--color-primary-50), var(--color-primary-30))' }} />
              )}

              <div className="px-5 py-5 md:px-6 md:py-6 space-y-6">
                {/* Header — identity (left) · sign out (top-right) */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    {/* Avatar — Nostr profile picture with initial fallback */}
                    <div
                      className={cn(
                        'relative', 'flex', 'items-center', 'justify-center',
                        'w-14', 'h-14', 'rounded-2xl', 'border-2', 'flex-shrink-0', 'text-xl', 'overflow-hidden',
                      )}
                      style={{
                        backgroundColor: 'var(--color-primary-10)',
                        borderColor: 'var(--color-primary-30)',
                        color: 'var(--color-primary-50)',
                      }}
                    >
                      {!identityData?.picture && ((identityData?.name || lnAddress)?.[0]?.toUpperCase() ?? <PersonIcon sx={{ fontSize: '1.5rem' }} />)}
                      {identityData?.picture && (
                        <img
                          src={identityData.picture}
                          alt=""
                          aria-hidden
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                        />
                      )}
                    </div>

                    {/* Name + badges */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[18px] font-semibold leading-tight text-[var(--theme-text)] truncate max-w-full">
                          {identityData?.name || lnAddress || (npub ? `${npub.slice(0, 10)}…` : 'Account')}
                        </span>
                        {identityData && <IdentityLevelBadge level={currentLevel as 0|1|2|3} size="small" />}
                        {identityData && <IdentityStatusBadge status={identityStatus} />}
                      </div>
                      {identityData?.nip05 && (
                        <span className="block mt-0.5 text-[12px] text-[var(--theme-text-muted)] truncate">
                          {identityData.nip05}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Sign out — ghost, clearly separated top-right */}
                  <button
                    onClick={handleLogout}
                    className={cn(
                      'flex', 'items-center', 'gap-1.5', 'px-3', 'py-1.5', 'rounded-lg',
                      'border', 'text-[12px]', 'font-medium', 'flex-shrink-0',
                      'transition-colors', 'duration-150', 'active:scale-[0.97]',
                    )}
                    style={{
                      color: 'var(--color-status-error)',
                      borderColor: 'var(--color-status-error)',
                      backgroundColor: 'transparent',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-status-error-bg)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <LogoutIcon sx={{ fontSize: 15 }} />
                    <span className="hidden sm:inline">Sign out</span>
                  </button>
                </div>

                {/* Account details — clean definition list */}
                {(lnAddress || evmAddress || pubkey) && (
                  <dl className="space-y-3">
                    {lnAddress && (
                      <DetailRow label="Lightning">
                        <BoltIcon sx={{ fontSize: 13, color: 'var(--color-primary-50)' }} />
                        <span className="text-[12px] text-[var(--theme-text)] font-mono truncate">
                          {lnAddress}
                        </span>
                        {balance !== null && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
                            style={{ background: 'var(--color-primary-10)', color: 'var(--color-primary-50)' }}
                          >
                            {formatNumber(balance)} sats
                          </span>
                        )}
                      </DetailRow>
                    )}

                    {evmAddress && (
                      <DetailRow label="EVM Address">
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
                          style={{ background: 'var(--color-status-info-bg)', color: 'var(--color-status-info)' }}
                        >
                          MetaMask
                        </span>
                        <span className="text-[12px] text-[var(--theme-text)] font-mono truncate">
                          {evmAddress}
                        </span>
                      </DetailRow>
                    )}

                    {npub && (
                      <DetailRow label="Nostr Pubkey">
                        <div
                          onClick={handleCopyPubkey}
                          role="button"
                          tabIndex={0}
                          title={copied ? 'Copied!' : 'Copy npub'}
                          aria-label="Copy Nostr npub"
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopyPubkey() } }}
                          className={cn(
                            'inline-flex', 'items-center', 'gap-1.5',
                            'px-2.5', 'py-1', 'rounded-md',
                            'cursor-pointer', 'max-w-full',
                            'border', 'border-[var(--theme-border)]', 'bg-[var(--theme-bg-subtle)]',
                            'transition-colors', 'duration-150',
                            'hover:bg-[var(--theme-bg-elevated)]', 'hover:border-[var(--color-primary-30)]',
                            'active:scale-[0.98]',
                          )}
                        >
                          <span
                            className={cn(
                              'text-[11px]', 'font-mono', 'truncate',
                              'max-w-[180px] sm:max-w-[260px] md:max-w-[320px]',
                            )}
                            style={{ color: copied ? 'var(--color-status-success)' : 'var(--theme-text)' }}
                          >
                            {npub}
                          </span>
                          <ContentCopyIcon sx={{ fontSize: 12, color: 'var(--theme-text-muted)', flexShrink: 0 }} />
                        </div>
                      </DetailRow>
                    )}
                  </dl>
                )}

                {/* Metrics row */}
                <div
                  className={cn(
                    'pt-6',
                    'border-t',
                    'grid',
                    'grid-cols-2',
                    'sm:grid-cols-3',
                    'gap-x-6',
                    'sm:gap-x-8',
                    'gap-y-6',
                  )}
                  style={{ borderColor: 'var(--theme-border)' }}
                >
                  {identityData && (
                    <MetricItem
                      label="Review Score"
                      helpTo="/help/identity-trust#id-3"
                      helpTitle="How your review score is calculated"
                      caption={
                        identityData.reviewCount && identityData.reviewCount > 0
                          ? `From ${identityData.reviewCount} review${identityData.reviewCount === 1 ? '' : 's'} after trades`
                          : 'Earned from buyer/seller reviews after completed trades'
                      }
                    >
                      <ReputationScore score={identityData.reputationScore} reviewCount={identityData.reviewCount} size="compact" />
                    </MetricItem>
                  )}

                  {identityData && (
                    <MetricItem
                      label="COL-Points"
                      helpTo="/help/identity-trust#id-4"
                      helpTitle="How COL-Points are earned"
                      caption="Earned by trades, reviews, identity & governance"
                    >
                      <div className="flex items-baseline gap-1">
                        <EmojiEventsIcon sx={{ color: 'var(--color-primary-50)', fontSize: 18 }} />
                        <span className="text-[18px] font-semibold text-[var(--theme-text)] tabular-nums">
                          {formatNumber(identityData.colPoints)}
                        </span>
                        <span className="text-[10px] text-[var(--theme-text-muted)]">pts</span>
                      </div>
                    </MetricItem>
                  )}

                  <MetricItem
                    label="DAO Membership"
                    helpTo="/help/dao-governance#dao-1"
                    helpTitle="How the Colabonate DAO works"
                    caption={
                      daoMembership && daoMembership.status !== 'REVOKED'
                        ? `Colabonate Foundation · ${daoMembership.status === 'PENDING' ? 'invitation pending' : 'active member'}`
                        : 'Join the Foundation DAO to govern the protocol'
                    }
                  >
                    {daoMembership && daoMembership.status !== 'REVOKED' ? (
                      <div className="flex items-center gap-1.5">
                        <AccountBalanceIcon sx={{ color: 'var(--color-accent-5)', fontSize: 18 }} />
                        <span className="text-[18px] font-semibold text-[var(--theme-text)]">
                          {DAO_ROLE_LABELS[daoMembership.role]}
                        </span>
                        {daoMembership.status === 'PENDING' && (
                          <span
                            className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                            style={{
                              color: 'var(--color-status-warning)',
                              background: 'rgba(245,158,11,0.12)',
                            }}
                          >
                            Pending
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <AccountBalanceIcon sx={{ color: 'var(--theme-text-muted)', fontSize: 18 }} />
                        <span className="text-[18px] font-semibold text-[var(--theme-text-muted)]">
                          Community
                        </span>
                      </div>
                    )}
                  </MetricItem>

                  {completionRate !== null && (
                    <MetricItem
                      label="Completion"
                      helpTo="/help/identity-trust#id-3"
                      helpTitle="How completion rate works"
                      caption="Share of tickets that reached Completed"
                    >
                      <div className="flex items-center gap-1">
                        <CheckCircleOutlineIcon
                          sx={{
                            fontSize: 18,
                            color: completionRate >= 80
                              ? 'var(--color-status-success)'
                              : completionRate >= 50
                              ? 'var(--color-status-warning)'
                              : 'var(--theme-text-muted)',
                          }}
                        />
                        <span
                          className="text-[18px] font-semibold tabular-nums"
                          style={{
                            color: completionRate >= 80
                              ? 'var(--color-status-success)'
                              : completionRate >= 50
                              ? 'var(--color-status-warning)'
                              : 'var(--theme-text-muted)',
                          }}
                        >
                          {completionRate}%
                        </span>
                      </div>
                    </MetricItem>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Activity KPIs (top right) ──────────────────────────────────────── */}
          <div>
            <SectionHeader title="Activity" subtitle="Your marketplace activity at a glance" />
            <KPIStrip
              items={activityKpis}
              loading={loading}
              skeletonCount={4}
              wrap
            />
          </div>

          {/* ── Company (bottom right) ─────────────────────────────────────────── */}
          <div>
            <SectionHeader title="Company" subtitle="Manage your business profile and catalog" />
            {company ? (
              <div
                className={cn(
                  'rounded-2xl',
                  'border',
                  'border-[var(--theme-border)]',
                  'bg-[var(--theme-surface)]',
                  'p-5',
                  'md:p-6',
                )}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      'flex',
                      'items-center',
                      'justify-center',
                      'w-10',
                      'h-10',
                      'rounded-xl',
                      'flex-shrink-0',
                    )}
                    style={{
                      backgroundColor: 'var(--color-primary-10)',
                      color: 'var(--color-primary-50)',
                    }}
                  >
                    <StorefrontIcon sx={{ fontSize: 20 }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="block text-[16px] font-semibold text-[var(--theme-text)]">
                      {company.name}
                    </span>
                    {company.city && (
                      <span className="block text-[12px] text-[var(--theme-text-muted)]">{company.city}</span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className={cn(
                      'flex',
                      'items-center',
                      'gap-1',
                      'px-2.5',
                      'py-1',
                      'rounded-lg',
                      'border',
                      'text-[12px]',
                      'font-medium',
                      'flex-shrink-0',
                      'transition-colors',
                      'duration-150',
                    )}
                    style={{
                      color: 'var(--color-status-error)',
                      borderColor: 'var(--color-status-error)',
                      backgroundColor: 'transparent',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-status-error-bg)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <DeleteIcon sx={{ fontSize: 14 }} />
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'rounded-2xl',
                  'border',
                  'border-[var(--theme-border)]',
                  'bg-[var(--theme-surface)]',
                  'p-5',
                  'md:p-6',
                )}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      'flex',
                      'items-center',
                      'justify-center',
                      'w-10',
                      'h-10',
                      'rounded-xl',
                      'flex-shrink-0',
                    )}
                    style={{
                      backgroundColor: 'var(--color-primary-10)',
                      color: 'var(--color-primary-50)',
                    }}
                  >
                    <StorefrontIcon sx={{ fontSize: 20 }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="block text-[16px] font-semibold text-[var(--theme-text)]">
                      No Company Profile
                    </span>
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--theme-text-muted)]">
                      Create a company profile to start selling products and managing your catalog.
                    </p>
                  </div>
                  <button
                    onClick={() => navigate('/sell/company/setup')}
                    className={cn(
                      'flex',
                      'items-center',
                      'gap-1',
                      'px-3',
                      'py-1.5',
                      'rounded-lg',
                      'text-[12px]',
                      'font-medium',
                      'flex-shrink-0',
                      'transition-colors',
                      'duration-150',
                    )}
                    style={{
                      backgroundColor: 'var(--color-primary-50)',
                      color: 'white',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                  >
                    <StorefrontIcon sx={{ fontSize: 14 }} />
                    Create
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── AI Assistant (hosted request standing, ADR-384) */}
        <div>
          <SectionHeader title="AI Assistant" subtitle="Your hosted AI requests and status" />
          <AiRequestsKpi />
        </div>

        {/* ── Newsletter (ADR-402 D15.2) — status here, switch in Settings */}
        <div>
          <SectionHeader title="Newsletter" subtitle="Whether we send you our community newsletter" />
          <NewsletterPreference variant="summary" />
        </div>

        {/* ── Email-login explainer (only for users who signed in via magic link) */}
        {showEmailExplainer && emailForExplainer && (
          <EmailLoginExplainer
            email={emailForExplainer}
            identityLevel={currentLevel}
            hasLinkedLightning={!!localStorage.getItem('linkedPubkey')}
          />
        )}

        {/* ── Identity & Security (Sub-Tabs, ADR-195) ─────────────────────────── */}
        <div id="identity-security">
          <SectionHeader
            title="Identity & Security"
            subtitle="Your identity key, trust level, signer, and wallet custody, all in one place."
          />
          <IdentitySecurityTabs
            pubkey={pubkey}
            identityData={identityData}
            onIdentityChanged={setIdentityData}
          />
        </div>

        {/* ── Reviews ─────────────────────────────────────────────────────────── */}
        {receivedReviews.length > 0 && (
          <div>
            <SectionHeader title={`Reviews (${receivedReviews.length})`} subtitle="What others say about working with you" />
            <div
              className={cn(
                'rounded-2xl',
                'border',
                'border-[var(--theme-border)]',
                'bg-[var(--theme-surface)]',
              )}
            >
              <div className="divide-y divide-[var(--theme-border)]">
                {receivedReviews.map((review) => (
                  <div key={review.id} className="px-6 py-6 md:px-8">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex items-center gap-1">
                        {[...Array(5)].map((_, i) => (
                          <span
                            key={i}
                            style={{
                              color: i < review.stars ? 'var(--color-review-star)' : 'var(--theme-border)',
                              fontSize: '16px',
                            }}
                          >
                            ★
                          </span>
                        ))}
                      </div>
                      <span
                        className={cn(
                          'text-[var(--typography-paragraph-xsmall-regular-fontsize,11px)]',
                          'text-[var(--theme-text-muted)]',
                        )}
                      >
                        {formatDate(new Date(review.createdAt))}
                      </span>
                    </div>
                    <p
                      className={cn(
                        'text-[var(--typography-paragraph-base-regular-fontsize,16px)]',
                        'leading-[var(--typography-paragraph-base-regular-lineheight,21px)]',
                        'text-[var(--theme-text)]',
                      )}
                    >
                      {review.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Sign out (session) ──────────────────────────────────────────────── */}
        <div
          className="rounded-2xl border px-5 py-5 md:px-6 md:py-6"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-status-error) 28%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--color-status-error) 5%, transparent)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              {/* Icon tile — danger tinted, consistent with other account tiles */}
              <span
                className="flex items-center justify-center rounded-2xl border-2 shrink-0"
                style={{
                  width: '3rem',
                  height: '3rem',
                  backgroundColor: 'color-mix(in srgb, var(--color-status-error) 12%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--color-status-error) 30%, transparent)',
                  color: 'var(--color-status-error)',
                }}
              >
                <LogoutIcon />
              </span>
              <div className="min-w-0">
                <h3
                  className="text-[15px] font-semibold"
                  style={{ color: 'var(--color-status-error)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  Sign out
                </h3>
                <p
                  className="mt-1 text-[12px] leading-relaxed"
                  style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  Ends this session and clears your local data (public key and Lightning address) from this browser. You can sign back in anytime. No data is lost on the server.
                </p>
              </div>
            </div>

            <Button
              variant="outlined"
              onClick={handleLogout}
              startIcon={<LogoutIcon />}
              sx={{
                textTransform: 'none',
                borderRadius: '12px',
                fontWeight: 600,
                fontSize: '13px',
                px: 2,
                py: 1,
                fontFamily: 'var(--typography-fontfamily-sans)',
                color: 'var(--color-status-error)',
                borderColor: 'color-mix(in srgb, var(--color-status-error) 40%, transparent)',
                '&:hover': {
                  borderColor: 'var(--color-status-error)',
                  backgroundColor: 'var(--color-status-error-bg)',
                },
              }}
            >
              Sign out now
            </Button>
          </div>
        </div>

        {/* ── Onboarding Reset ─────────────────────────────────────────────────── */}
        <div>
          <SectionHeader
            title="Onboarding"
            subtitle="Manage your onboarding state and restart the setup wizard if needed"
          />
          <div
            className={cn(
              'rounded-2xl',
              'border',
              'border-[var(--theme-border)]',
              'bg-[var(--theme-surface)]',
              'p-6',
              'md:p-8',
            )}
          >
            <div className="flex flex-col gap-4">
              {/* Header row: icon + title/description + action */}
              <div className="flex items-start gap-4 flex-wrap">
                {/* Icon */}
                <div
                  className={cn(
                    'flex',
                    'items-center',
                    'justify-center',
                    'w-11',
                    'h-11',
                    'rounded-xl',
                    'flex-shrink-0',
                  )}
                  style={{
                    backgroundColor: 'var(--color-status-info-bg)',
                    color: 'var(--color-status-info)',
                  }}
                >
                  <RestartAltIcon sx={{ fontSize: 22 }} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-[180px]">
                  <h4
                    className={cn(
                      'text-[var(--typography-heading-h5-mobile-regular-fontsize,20px)]',
                      'font-[var(--typography-heading-h5-mobile-regular-fontweight,400)]',
                      'text-[var(--theme-text)]',
                    )}
                  >
                    Reset Onboarding
                  </h4>
                  <p
                    className={cn(
                      'mt-1',
                      'max-w-2xl',
                      'text-[var(--typography-paragraph-small-regular-fontsize,13px)]',
                      'leading-[1.6]',
                      'text-[var(--theme-text-muted)]',
                    )}
                  >
                    Clears your onboarding progress and restarts the setup wizard on your next visit to the home page. Useful if you want to re-select your use cases or redo the creator setup.
                  </p>
                </div>

                {/* Button */}
                <button
                  onClick={() => {
                    localStorage.removeItem('hasCompletedOnboarding')
                    localStorage.removeItem('onboarding_features')
                    setOnboardingResetDone(true)
                    setTimeout(() => setOnboardingResetDone(false), 3000)
                  }}
                  className={cn(
                    'flex',
                    'items-center',
                    'gap-2',
                    'px-4',
                    'py-2',
                    'rounded-lg',
                    'border',
                    'text-sm',
                    'font-medium',
                    'transition-colors',
                    'duration-150',
                    'flex-shrink-0',
                    'self-start',
                  )}
                  style={{
                    color: 'var(--color-status-info)',
                    borderColor: 'var(--color-status-info)',
                    backgroundColor: 'transparent',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-status-info)15'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <RestartAltIcon fontSize="small" />
                  Reset Onboarding
                </button>
              </div>

              {/* What it does — responsive multi-column grid */}
              <ul
                className={cn(
                  'grid',
                  'grid-cols-1',
                  'sm:grid-cols-2',
                  'lg:grid-cols-3',
                  'gap-x-5',
                  'gap-y-2',
                  'text-[var(--typography-paragraph-small-regular-fontsize,13px)]',
                  'text-[var(--theme-text-muted)]',
                )}
              >
                <li className="flex items-start gap-2">
                  <span className="text-[var(--color-status-info)] mt-0.5">→</span>
                  <span>Resets the welcome slider and feature selection (Kaufen, Verkaufen, Kooperieren)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--color-status-info)] mt-0.5">→</span>
                  <span>Redirects you to <code className="px-1 py-0.5 rounded bg-[var(--theme-bg-subtle)] text-xs">/onboarding/welcome</code> on next home page visit</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--color-status-info)] mt-0.5">→</span>
                  <span>Your account, company, and marketplace data remain untouched</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* ── Delete Company Modal ─────────────────────────────────────────────── */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowDeleteModal(false)}
            />
            <div
              className={cn(
                'relative',
                'w-full',
                'max-w-md',
                'rounded-2xl',
                'p-6',
                'md:p-8',
                'border',
                'shadow-2xl',
              )}
              style={{
                backgroundColor: 'var(--theme-surface)',
                borderColor: 'var(--theme-border)',
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className={cn(
                    'flex',
                    'items-center',
                    'justify-center',
                    'w-10',
                    'h-10',
                    'rounded-full',
                    'flex-shrink-0',
                  )}
                  style={{
                    backgroundColor: 'var(--color-status-error)10',
                    color: 'var(--color-status-error)',
                  }}
                >
                  <WarningIcon sx={{ fontSize: 20 }} />
                </div>
                <h3
                  className={cn(
                    'text-[var(--typography-heading-h5-mobile-regular-fontsize,20px)]',
                    'font-[var(--typography-heading-h5-mobile-regular-fontweight,600)]',
                    'text-[var(--theme-text)]',
                  )}
                >
                  Delete Company
                </h3>
              </div>

              <div className="mb-6">
                <p
                  className={cn(
                    'text-[var(--typography-paragraph-base-regular-fontsize,16px)]',
                    'text-[var(--theme-text-muted)]',
                    'mb-4',
                  )}
                >
                  Are you sure you want to deactivate your company profile? This action:
                </p>
                <ul
                  className={cn(
                    'list-disc',
                    'list-inside',
                    'space-y-2',
                    'text-[var(--typography-paragraph-small-regular-fontsize,13px)]',
                    'text-[var(--theme-text-muted)]',
                    'mb-4',
                  )}
                >
                  <li>
                    <span className="font-semibold text-[var(--theme-text)]">Visibility:</span> Your company will be hidden from the marketplace
                  </li>
                  <li>
                    <span className="font-semibold text-[var(--theme-text)]">Data preserved:</span> All catalogs, products, offers, and tickets remain intact
                  </li>
                  <li>
                    <span className="font-semibold text-[var(--theme-text)]">Reversible:</span> You can re-activate your company at any time
                  </li>
                </ul>
                <p
                  className={cn(
                    'text-[var(--typography-paragraph-small-regular-fontsize,13px)]',
                    'text-[var(--theme-text-muted)]',
                  )}
                >
                  No data is permanently deleted. Your company profile can be restored by saving it again.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className={cn(
                    'flex-1',
                    'px-4',
                    'py-2.5',
                    'rounded-lg',
                    'text-sm',
                    'font-medium',
                    'transition-colors',
                    'duration-150',
                  )}
                  style={{
                    backgroundColor: 'var(--theme-bg-subtle)',
                    color: 'var(--theme-text)',
                    border: '1px solid var(--theme-border)',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--theme-bg-elevated)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--theme-bg-subtle)'}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteCompany}
                  className={cn(
                    'flex-1',
                    'px-4',
                    'py-2.5',
                    'rounded-lg',
                    'text-sm',
                    'font-medium',
                    'transition-colors',
                    'duration-150',
                  )}
                  style={{
                    backgroundColor: 'var(--color-status-error)',
                    color: 'white',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  Deactivate Company
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Snackbar ─────────────────────────────────────────────────────────── */}
        {copied && (
          <div className="fixed z-50 -translate-x-1/2 bottom-4 left-1/2">
            <div className={cn('px-6', 'py-3', 'rounded-lg', 'bg-[var(--color-status-success)]', 'text-[var(--color-neutral-black)]', 'shadow-lg')}>
              Public key copied to clipboard!
            </div>
          </div>
        )}
        {onboardingResetDone && (
          <div className="fixed z-50 -translate-x-1/2 bottom-4 left-1/2">
            <div className={cn('px-6', 'py-3', 'rounded-lg', 'bg-[var(--color-status-info-bg)]', 'text-[var(--color-status-info)]', 'shadow-lg')}>
              Onboarding reset. Visit the home page to restart the wizard.
            </div>
          </div>
        )}

      </div>

    </PageContainer>
  )
}
