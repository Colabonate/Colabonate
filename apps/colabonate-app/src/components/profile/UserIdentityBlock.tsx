import { Link } from 'react-router-dom'
import { EntityProfileHeader } from '@ds/ui'
import { cn } from '@ds/utils'
import { useTranslation } from '../../contexts/LocaleContext'
import { IdentityLevelBadge } from '../../components/identity/IdentityLevelBadge'
import { ReputationScore } from '../../components/reputation/ReputationScore'
import type { UserProfileResponse } from '../../types/api'
import type { Review, IdentityLevel } from '../../types/identity'
import BoltIcon from '@mui/icons-material/Bolt'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import LockIcon from '@mui/icons-material/Lock'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import Inventory2Icon from '@mui/icons-material/Inventory2'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import SellIcon from '@mui/icons-material/Sell'

export type DaoRole = 'ADMIN' | 'ARBITRATOR' | 'MEDIATOR'
export type DaoMemberStatus = 'PENDING' | 'ACTIVE' | 'REVOKED'

export interface DaoMembership {
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

const VISIBILITY_LABELS: Record<string, { label: string; description: string }> = {
  PUBLIC: { label: 'Public Profile', description: 'All information visible to other users.' },
  PSEUDO_PRIVATE: { label: 'Pseudo-Private', description: 'Name and company hidden. Stats and reviews remain visible.' },
  PRIVATE: { label: 'Private Profile', description: 'Only identity level visible. Everything else hidden.' },
}

// ADR-367 D1: the read-only Nostr identity block for /u/:pubkey.
// Header + About/bio + reputation/COL-Points/DAO strip + activity stats + reviews.
// Owned-content (offers/catalogs/bounties) is NOT part of this block — D8
// supersedes the offer list with a page-level unified ListBrowser.
export interface UserIdentityBlockProps {
  profile: UserProfileResponse
  pubkey: string
  reviews: Review[]
  daoMembership: DaoMembership | null
  isOwnProfile: boolean
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block mb-3 text-sm font-semibold text-[var(--theme-text)]">{label}</span>
      {children}
    </div>
  )
}

function StatCard({ icon, value, label, color }: {
  icon: React.ReactNode
  value: number
  label: string
  color: string
}) {
  return (
    <div
      className={cn(
        'rounded-2xl',
        'border',
        'border-[var(--theme-border)]',
        'bg-[var(--theme-surface)]',
        'p-5',
        'md:p-6',
        'flex',
        'flex-col',
        'gap-2',
        'transition-shadow',
        'duration-200',
        'hover:shadow-lg',
      )}
    >
      <div style={{ color }}>{icon}</div>
      <span
        className={cn(
          'text-[var(--typography-heading-h4-mobile-regular-fontsize,23px)]',
          'font-[var(--typography-heading-h4-mobile-regular-fontweight,400)]',
          'leading-none',
          'tabular-nums',
        )}
        style={{ color }}
      >
        {value}
      </span>
      <span className="text-[13px] font-medium text-[var(--theme-text-muted)]">{label}</span>
    </div>
  )
}

export function UserIdentityBlock({ profile, pubkey, reviews, daoMembership, isOwnProfile }: UserIdentityBlockProps) {
  const { formatNumber, formatDate } = useTranslation()

  const level = profile.identityLevel as IdentityLevel
  const visInfo = VISIBILITY_LABELS[profile.visibility] || VISIBILITY_LABELS.PUBLIC
  const isPrivate = profile.visibility === 'PRIVATE'
  const displayName = profile.name
    || profile.lnAddress
    || (isPrivate ? 'Anonymous User' : `${pubkey.slice(0, 8)}…`)

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      {isPrivate && (
        <div
          className={cn('rounded-xl', 'border', 'px-5', 'py-5', 'flex', 'items-center', 'gap-4')}
          style={{
            borderColor: 'var(--theme-border)',
            backgroundColor: 'var(--theme-bg-subtle)',
          }}
        >
          <LockIcon sx={{ fontSize: 24, color: 'var(--theme-text-muted)' }} />
          <div>
            <span className="block text-sm font-semibold text-[var(--theme-text)]">{visInfo.label}</span>
            <span className="block text-[13px] text-[var(--theme-text-muted)] mt-0.5">{visInfo.description}</span>
          </div>
        </div>
      )}

      {!isPrivate && (
        <EntityProfileHeader
          variant="user"
          bannerUrl={profile.banner}
          avatarUrl={profile.picture}
          title={displayName}
          badges={
            <>
              <IdentityLevelBadge level={level} size="small" />
              {isOwnProfile && (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                  style={{ backgroundColor: 'var(--color-primary-10)', color: 'var(--color-primary-50)' }}
                >
                  Your Profile
                </span>
              )}
            </>
          }
          subtitle={
            <div>
              {profile.nip05 && (
                <div className="flex items-center gap-1.5 mb-2">
                  <CheckCircleOutlineIcon sx={{ fontSize: 14, color: 'var(--color-status-success)' }} />
                  <span className="text-[13px] text-[var(--theme-text-muted)] truncate">{profile.nip05}</span>
                </div>
              )}
              {profile.about && (
                <p className="text-[13px] leading-relaxed text-[var(--theme-text-muted)] mb-3 max-w-xl">
                  {profile.about}
                </p>
              )}
              {profile.lnAddress && (
                <div className="flex items-center gap-2">
                  <BoltIcon sx={{ fontSize: 16, color: 'var(--color-primary-50)' }} />
                  <span className="text-[13px] text-[var(--theme-text-muted)] font-mono">{profile.lnAddress}</span>
                </div>
              )}
            </div>
          }
        />
      )}

      {!isPrivate && (
        <div
          className={cn('rounded-2xl', 'border', 'border-[var(--theme-border)]', 'bg-[var(--theme-surface)]', 'px-6', 'py-6', 'md:px-8', 'md:py-8')}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-1 mb-2">
                <h5 className="m-0">Review Score</h5>
                <Link to="/help/identity-trust#id-3" aria-label="Learn how your review score is calculated" title="How your review score is calculated" className="inline-flex items-center justify-center rounded transition-colors hover:text-[var(--color-primary-50)]" style={{ color: 'var(--theme-text-muted)' }}>
                  <InfoOutlinedIcon sx={{ fontSize: 15 }} />
                </Link>
              </div>
              {profile.reputationScore !== undefined && profile.reviewCount !== undefined ? (
                <ReputationScore score={profile.reputationScore} reviewCount={profile.reviewCount} size="full" />
              ) : (
                <span className="text-[13px] text-[var(--theme-text-muted)]">No data</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1 mb-2">
                <h5 className="m-0">COL-Points</h5>
                <Link to="/help/identity-trust#id-4" aria-label="Learn how COL-Points are earned" title="How COL-Points are earned" className="inline-flex items-center justify-center rounded transition-colors hover:text-[var(--color-primary-50)]" style={{ color: 'var(--theme-text-muted)' }}>
                  <InfoOutlinedIcon sx={{ fontSize: 15 }} />
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <EmojiEventsIcon sx={{ color: 'var(--color-primary-50)', fontSize: 24 }} />
                <span className={cn('text-[var(--typography-heading-h4-mobile-regular-fontsize,23px)]', 'font-[var(--typography-heading-h4-mobile-regular-fontweight,400)]', 'text-[var(--theme-text)]', 'tabular-nums')}>
                  {formatNumber(profile.colPoints ?? 0)}
                </span>
                <span className="text-[13px] text-[var(--theme-text-muted)]">pts</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1 mb-2">
                <h5 className="m-0">DAO Membership</h5>
                <Link to="/help/dao-governance#dao-1" aria-label="Learn how the Colabonate DAO works" title="How the Colabonate DAO works" className="inline-flex items-center justify-center rounded transition-colors hover:text-[var(--color-primary-50)]" style={{ color: 'var(--theme-text-muted)' }}>
                  <InfoOutlinedIcon sx={{ fontSize: 15 }} />
                </Link>
              </div>
              {daoMembership && daoMembership.status !== 'REVOKED' ? (
                <>
                  <div className="flex items-center gap-2">
                    <AccountBalanceIcon sx={{ color: 'var(--color-accent-5)', fontSize: 24 }} />
                    <span className="text-[18px] font-semibold text-[var(--theme-text)]">{DAO_ROLE_LABELS[daoMembership.role]}</span>
                    {daoMembership.status === 'PENDING' && (
                      <span className="text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ color: 'var(--color-status-warning)', background: 'rgba(245,158,11,0.12)' }}>
                        Pending
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-tight text-[var(--theme-text-muted)]">
                    Colabonate Foundation
                    {(daoMembership.acceptedAt || daoMembership.addedAt) && (
                      <>
                        {' · '}
                        {daoMembership.status === 'PENDING' ? 'invited' : 'member since'}{' '}
                        {formatDate(new Date(daoMembership.acceptedAt ?? daoMembership.addedAt!))}
                      </>
                    )}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <AccountBalanceIcon sx={{ color: 'var(--theme-text-muted)', fontSize: 24 }} />
                    <span className="text-[18px] font-semibold text-[var(--theme-text-muted)]">Community</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-tight text-[var(--theme-text-muted)]">
                    Not a Foundation DAO member
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {profile.stats && !isPrivate && (
        <Section label="Activity">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={<Inventory2Icon sx={{ fontSize: 18 }} />} value={profile.stats.offersCreated} label="Offers" color="var(--color-primary-50)" />
            <StatCard icon={<CheckCircleOutlineIcon sx={{ fontSize: 18 }} />} value={profile.stats.completedTickets} label="Completed" color="var(--color-status-success)" />
            <StatCard icon={<ShoppingCartIcon sx={{ fontSize: 18 }} />} value={profile.stats.completedAsBuyer} label="As Buyer" color="var(--color-status-info)" />
            <StatCard icon={<SellIcon sx={{ fontSize: 18 }} />} value={profile.stats.completedAsSeller} label="As Seller" color="var(--color-secondary-50)" />
          </div>
          {profile.stats.completionRate !== null && (
            <div className="mt-4">
              <span
                className={cn('inline-flex', 'items-center', 'gap-2', 'px-3', 'py-1', 'rounded-full', 'text-[0.75rem]', 'border')}
                style={{
                  borderColor: profile.stats.completionRate >= 80 ? 'var(--color-status-success)' : profile.stats.completionRate >= 50 ? 'var(--color-status-warning)' : 'var(--theme-border)',
                  color: profile.stats.completionRate >= 80 ? 'var(--color-status-success)' : profile.stats.completionRate >= 50 ? 'var(--color-status-warning)' : 'var(--theme-text-muted)',
                }}
              >
                <CheckCircleOutlineIcon sx={{ fontSize: 14 }} />
                {profile.stats.completionRate}% completion rate
              </span>
            </div>
          )}
        </Section>
      )}

      {reviews.length > 0 && !isPrivate && (
        <Section label={`Reviews (${reviews.length})`}>
          <div className={cn('rounded-2xl', 'border', 'border-[var(--theme-border)]', 'bg-[var(--theme-surface)]')}>
            <div className="divide-y divide-[var(--theme-border)]">
              {reviews.slice(0, 10).map((review) => (
                <div key={review.id} className="px-6 py-5 md:px-8">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex items-center gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <span key={i} style={{ color: i < review.stars ? 'var(--color-review-star)' : 'var(--theme-border)', fontSize: '14px' }}>★</span>
                      ))}
                    </div>
                    <span className="text-[11px] text-[var(--theme-text-muted)]">
                      {formatDate(new Date(review.createdAt))}
                    </span>
                  </div>
                  <p className="text-[var(--typography-paragraph-base-regular-fontsize,16px)] leading-[1.6] text-[var(--theme-text)]">
                    {review.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      <div
        className={cn('rounded-xl', 'border', 'border-[var(--theme-border)]', 'bg-[var(--theme-bg-subtle)]', 'px-5', 'py-4', 'flex', 'items-center', 'gap-3')}
      >
        <AccountCircleIcon sx={{ fontSize: 16, color: 'var(--theme-text-muted)' }} />
        <span className="text-[13px] font-mono text-[var(--theme-text-muted)] break-all">{pubkey}</span>
      </div>
    </div>
  )
}
