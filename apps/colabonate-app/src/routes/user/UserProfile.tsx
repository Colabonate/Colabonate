import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { NotFoundState } from '../../components/NotFoundState'
import { IdentityLevelBadge } from '../../components/identity/IdentityLevelBadge'
import { apiCall } from '../../lib/api'
import { useCompanyById } from '../../hooks/useEntityQueries'
import { useEntityOwnedContent } from '../../hooks/useEntityOwnedContent'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { UserIdentityBlock, type DaoMembership } from '../../components/profile/UserIdentityBlock'
import { CompanyBlock } from '../../components/profile/CompanyBlock'
import { EntityContentList } from '../../components/profile/EntityContentList'
import type { UserProfileResponse } from '../../types/api'
import type { Review, IdentityLevel } from '../../types/identity'
import PersonIcon from '@mui/icons-material/Person'
import CircularProgress from '@mui/material/CircularProgress'

export function UserProfile() {
  const { pubkey } = useParams<{ pubkey: string }>()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [daoMembership, setDaoMembership] = useState<DaoMembership | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const pageRef = usePageAnimation([
    { selector: '.page-animate', from: { duration: 0.5, y: 20 } },
  ])

  const fetchData = useCallback(async () => {
    if (!pubkey) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const [profileRes, reviewsRes, daoMembersRes] = await Promise.all([
        apiCall(`/api/user/${pubkey}/profile`).then(r => r.json()).catch(() => null),
        apiCall(`/api/identity/reviews/${pubkey}`).then(r => r.json()).catch(() => ({ reviews: [] })),
        apiCall(`/api/dao/foundation/members`).then(r => r.json()).catch(() => ({ members: [] })),
      ])

      if (!profileRes || profileRes.error) {
        setError(profileRes?.message || 'User not found')
        setProfile(null)
      } else {
        setProfile(profileRes)
      }

      if (profileRes && profileRes.visibility !== 'PRIVATE') {
        setReviews(reviewsRes?.reviews || [])
      }

      const members: Array<{ pubkey: string; role: DaoMembership['role']; status: DaoMembership['status']; addedAt?: string; acceptedAt?: string | null }> =
        daoMembersRes?.members ?? []
      const match =
        members.find(m => m.pubkey === pubkey && m.status === 'ACTIVE') ??
        members.find(m => m.pubkey === pubkey && m.status === 'PENDING') ??
        null
      setDaoMembership(match)
    } catch {
      setError('Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [pubkey])

  useEffect(() => { fetchData() }, [fetchData])

  // Live Kind 0 fallback: when the DB has no Nostr display metadata for this
  // user yet (they never synced), fetch it live from public relays via the
  // server proxy so partners still show their real Nostr profile. Display-only
  // merge — never persisted from the viewer's side. Skipped for non-PUBLIC
  // visibility (same policy as the server's field gating) and non-hex pubkeys.
  useEffect(() => {
    if (!pubkey || !profile) return
    if (profile.visibility !== 'PUBLIC') return
    if (profile.picture || profile.name) return
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) return
    let cancelled = false
    apiCall(`/api/nostr/profile/${pubkey}`)
      .then(r => (r.ok ? r.json() : null))
      .then((k0: { name?: string; picture?: string; about?: string; banner?: string; nip05?: string } | null) => {
        if (cancelled || !k0) return
        if (!k0.picture && !k0.name) return
        setProfile(p => p
          ? {
              ...p,
              picture: p.picture ?? (k0.picture || null),
              name: p.name ?? (k0.name || null),
              about: p.about ?? (k0.about || null),
              banner: p.banner ?? (k0.banner || null),
              nip05: p.nip05 ?? (k0.nip05 || null),
            }
          : p)
      })
      .catch(() => {/* silent — fallback stays */})
    return () => { cancelled = true }
  }, [pubkey, profile])

  const isOwnProfile = pubkey === localStorage.getItem('pubkey')

  // Full Company for the inline CompanyBlock (D2) — profile.company is only a
  // teaser { id, name, logoUrl, city }; the block needs the whole row.
  const companyTeaserId = profile?.company?.id
  const { data: fullCompany } = useCompanyById(companyTeaserId ?? '')

  // Unified owned content (D8) — offers + catalogs + bounties + cooperations.
  // NOTE: hooks MUST stay above the loading/error early-returns — hooks after
  // conditional returns change the hook count between renders and crash with
  // "Rendered more hooks than during the previous render".
  const { items: ownedItems, loading: ownedLoading } = useEntityOwnedContent(pubkey ?? '', fullCompany?.id)

  if (loading) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <CircularProgress />
            <span className="text-[var(--theme-text-muted)] text-sm">Loading profile…</span>
          </div>
        </div>
      </PageContainer>
    )
  }

  if (error || !profile) {
    return (
      <NotFoundState
        icon={<PersonIcon sx={{ fontSize: { xs: 44, sm: 52 } }} />}
        title="User not found"
        message="This profile may be private, or the link is incorrect."
        detail={pubkey ? `User ${pubkey.slice(0, 16)}…` : undefined}
        primary={{ label: 'Back to partners', to: '/coop?filter=partners' }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  const level = profile.identityLevel as IdentityLevel
  const isPrivate = profile.visibility === 'PRIVATE'
  const displayName = profile.name
    || profile.lnAddress
    || (isPrivate ? 'Anonymous User' : `${pubkey!.slice(0, 8)}…`)
  const initialLetter = (profile.name || profile.lnAddress || '')[0]?.toUpperCase()

  return (
    <PageContainer size="narrow" spacing="lg" className="page-animate" ref={pageRef}>
      <PageHeader
        icon={
          <div
            className="relative flex items-center justify-center w-10 h-10 rounded-full flex-shrink-0 overflow-hidden"
            style={{
              backgroundColor: 'var(--color-primary-10)',
              color: 'var(--color-primary-50)',
            }}
          >
            {!isPrivate && profile.picture
              ? <span className="text-sm font-semibold">{initialLetter ?? <PersonIcon sx={{ fontSize: 20 }} />}</span>
              : profile.lnAddress && !isPrivate
                ? profile.lnAddress[0].toUpperCase()
                : <PersonIcon sx={{ fontSize: 20 }} />}
            {!isPrivate && profile.picture && (
              <img
                src={profile.picture}
                alt=""
                aria-hidden
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
            )}
          </div>
        }
        title={displayName}
        subtitle={
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <IdentityLevelBadge level={level} size="small" />
            {isOwnProfile && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ backgroundColor: 'var(--color-primary-10)', color: 'var(--color-primary-50)' }}
              >
                Your Profile
              </span>
            )}
          </div>
        }
        onBack={() => window.history.back()}
        backLabel="Go back"
      />

      <div className="flex flex-col gap-6 md:gap-8">
        <UserIdentityBlock
          profile={profile}
          pubkey={pubkey!}
          reviews={reviews}
          daoMembership={daoMembership}
          isOwnProfile={isOwnProfile}
        />

        {fullCompany && !isPrivate && (
          <div>
            <span className="block mb-3 text-sm font-semibold text-[var(--theme-text)]">
              Company
            </span>
            <CompanyBlock company={fullCompany} />
          </div>
        )}

        {!isPrivate && (
          <EntityContentList items={ownedItems} loading={ownedLoading} />
        )}
      </div>
    </PageContainer>
  )
}
