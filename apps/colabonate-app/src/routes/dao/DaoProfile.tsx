import { useEffect, useMemo, useState } from 'react'
import { Globe, MapPin, Calendar, Users, Vote, Wallet, ExternalLink, Pencil } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, TextField, Button } from '@mui/material'
import { useDaoLayoutData } from './DaoLayout'
import { DAO_TYPE_META, MEMBERSHIP_TYPE_META, FOCUS_AREAS, type DaoType, type MembershipType } from './dao-types'
import { apiCall } from '../../lib/api'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../../components/currency/FiatHint'
import { cn } from '@ds/utils'
import { MultiImageUploadInput } from '../../components/offers/MultiImageUploadInput'

function parseJsonField<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function getDaoTypeBannerGradient(type: DaoType | undefined): string {
  const gradients: Record<string, string> = {
    COMMUNITY:  'linear-gradient(135deg, rgba(99,179,237,0.28) 0%, rgba(99,179,237,0.06) 100%)',
    PROTOCOL:   'linear-gradient(135deg, rgba(159,122,234,0.28) 0%, rgba(159,122,234,0.06) 100%)',
    INVESTMENT: 'linear-gradient(135deg, rgba(236,201,75,0.28) 0%, rgba(236,201,75,0.06) 100%)',
    SERVICE:    'linear-gradient(135deg, rgba(79,209,197,0.28) 0%, rgba(79,209,197,0.06) 100%)',
    GRANT:      'linear-gradient(135deg, rgba(72,187,120,0.28) 0%, rgba(72,187,120,0.06) 100%)',
    SOCIAL:     'linear-gradient(135deg, rgba(104,211,145,0.28) 0%, rgba(104,211,145,0.06) 100%)',
    INDUSTRY:   'linear-gradient(135deg, rgba(246,173,85,0.28) 0%, rgba(246,173,85,0.06) 100%)',
    COLLECTOR:  'linear-gradient(135deg, rgba(252,129,129,0.28) 0%, rgba(252,129,129,0.06) 100%)',
  }
  return gradients[type ?? 'COMMUNITY'] ?? gradients.COMMUNITY
}

function DaoGallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0)
  const safeIndex = Math.min(active, images.length - 1)

  return (
    <div
      className="p-5 rounded-xl"
      style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
    >
      <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
        Gallery
      </p>

      {/* Main image */}
      <div
        className="w-full rounded-lg overflow-hidden mb-3"
        style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-bg-subtle)', aspectRatio: '3 / 2' }}
      >
        <img
          src={images[safeIndex]}
          alt={`${name} ${safeIndex + 1}`}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {images.map((url, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className="shrink-0 rounded-md overflow-hidden transition-all"
              style={{
                width: 56,
                height: 42,
                outline: i === safeIndex ? '2px solid var(--color-primary-50)' : '1px solid var(--theme-border)',
                outlineOffset: i === safeIndex ? '1px' : '0px',
                cursor: 'pointer',
              }}
            >
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function DaoProfile() {
  const { dao, members: contextMembers, treasuryBalance, loading } = useDaoLayoutData()

  const currentPubkey = typeof window !== 'undefined' ? localStorage.getItem('pubkey') : null

  // Fetch this DAO's actual members (the shared context returns foundation members).
  // Falls back to contextMembers (foundation) if the fetch hasn't resolved or fails.
  const [localMembers, setLocalMembers] = useState<import('../council/council-types').DaoMember[] | null>(null)
  useEffect(() => {
    if (!dao) return
    setLocalMembers(null)
    apiCall(`/api/daos/${dao.id}/members`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.members)) setLocalMembers(d.members) })
      .catch(() => { /* keep context fallback */ })
  }, [dao])

  const members = localMembers ?? contextMembers

  const isMember = useMemo(
    () => currentPubkey ? members.some(m => m.pubkey === currentPubkey && m.status === 'ACTIVE') : false,
    [members, currentPubkey],
  )
  const isAdmin = useMemo(
    () => currentPubkey ? members.some(m => m.pubkey === currentPubkey && m.role === 'ADMIN' && m.status === 'ACTIVE') : false,
    [members, currentPubkey],
  )

  const [editOpen, setEditOpen] = useState(false)

  const focusAreas = parseJsonField<string[]>(dao?.focusAreas, [])
  const images = parseJsonField<string[]>(dao?.images, [])
  const typeMeta = DAO_TYPE_META[dao?.daoType ?? 'COMMUNITY']
  const membershipMeta = MEMBERSHIP_TYPE_META[dao?.membershipType ?? 'OPEN']

  const locationTag = dao?.isOnlineOnly
    ? '🌐 Online / Global'
    : [dao?.city, dao?.region, dao?.country].filter(Boolean).join(', ')

  const foundedYear = dao?.foundedAt ? new Date(dao.foundedAt).getFullYear() : null

  async function handleJoin() {
    if (!dao || !currentPubkey) return
    await apiCall(`/api/daos/${dao.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: currentPubkey }),
    })
    window.location.reload()
  }

  if (loading || !dao) {
    return (
      <div className="flex items-center justify-center min-h-[30vh]">
        <div
          className="w-10 h-10 border-4 rounded-full border-t-transparent animate-spin"
          style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Banner */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
      >
        {/* Banner image / gradient */}
        <div
          className="h-[120px] flex items-end px-5 pb-0 relative"
          style={{
            background: dao.bannerUrl ? `url(${dao.bannerUrl}) center/cover` : getDaoTypeBannerGradient(dao.daoType as DaoType),
          }}
        >
          {/* Logo avatar — overlaps banner */}
          <div
            className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl translate-y-8 shrink-0"
            style={{ background: 'var(--theme-surface)', border: '3px solid var(--theme-border)' }}
          >
            {dao.logoUrl
              ? <img src={dao.logoUrl} alt="" className="w-full h-full rounded-xl object-cover" />
              : typeMeta.emoji}
          </div>
        </div>

        {/* Header info */}
        <div className="px-5 pt-10 pb-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-[20px] font-bold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                {dao.name}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded"
                  style={{ background: 'var(--theme-bg-subtle)', color: typeMeta.color, fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  {typeMeta.emoji} {typeMeta.label}
                </span>
                {locationTag && (
                  <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                    {dao.isOnlineOnly ? <Globe size={12} /> : <MapPin size={12} />}
                    {locationTag}
                  </span>
                )}
                <span
                  className="text-[11px] font-medium px-2 py-0.5 rounded"
                  style={{ background: membershipMeta.bg, color: membershipMeta.color, fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  {membershipMeta.label}
                </span>
                {foundedYear && (
                  <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                    <Calendar size={12} />
                    Founded {foundedYear}
                  </span>
                )}
              </div>
              {dao.description && (
                <p className="text-[13px] mt-2" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  {dao.description}
                </p>
              )}
            </div>

            {/* Actions: Edit (admin) / Join (non-member) */}
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button
                  onClick={() => setEditOpen(true)}
                  startIcon={<Pencil size={14} />}
                  sx={{
                    textTransform: 'none', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                    fontFamily: 'var(--typography-fontfamily-sans)',
                    color: 'var(--theme-text)', borderColor: 'var(--theme-border)',
                  }}
                  variant="outlined"
                  size="small"
                >
                  Edit Profile
                </Button>
              )}
              {currentPubkey && !isMember && (
                <JoinCTA membershipType={(dao.membershipType ?? 'OPEN') as MembershipType} onJoin={handleJoin} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body: About + Stats */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-5">
        {/* Left: About */}
        <div className="space-y-4">
          {dao.purpose && (
            <div
              className="p-5 rounded-xl"
              style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
            >
              <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                About
              </p>
              <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                {dao.purpose}
              </p>
            </div>
          )}

          {focusAreas.length > 0 && (
            <div
              className="p-5 rounded-xl"
              style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
            >
              <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                Focus Areas
              </p>
              <div className="flex flex-wrap gap-2">
                {focusAreas.map(area => (
                  <span
                    key={area}
                    className="text-[12px] px-3 py-1 rounded-full"
                    style={{ background: 'rgba(99,179,237,0.08)', color: 'var(--color-primary-50)', border: '1px solid rgba(99,179,237,0.2)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                  >
                    {area}
                  </span>
                ))}
              </div>
            </div>
          )}

          {images.length > 0 && (
            <DaoGallery images={images} name={dao.name} />
          )}

          {(dao.website || dao.language) && (
            <div
              className="p-5 rounded-xl"
              style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
            >
              <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                Links
              </p>
              <div className="space-y-2">
                {dao.website && (
                  <a
                    href={dao.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[13px] hover:opacity-70"
                    style={{ color: 'var(--color-primary-50)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                  >
                    <Globe size={14} />
                    {dao.website.replace(/^https?:\/\//, '')}
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Stats */}
        <div
          className="p-5 rounded-xl h-fit space-y-4"
          style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
            Stats
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                <Users size={13} /> Members
              </span>
              <span className="text-[13px] font-bold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                {dao._count.members}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                <Vote size={13} /> Proposals
              </span>
              <span className="text-[13px] font-bold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                {dao._count.proposals}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                <Wallet size={13} /> Treasury
              </span>
              <span className="text-[13px] font-bold" style={{ color: 'var(--color-warning-primary)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                {formatSats(Number(treasuryBalance), { compact: false })}{' '}
                <FiatHint sats={Number(treasuryBalance)} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
              </span>
            </div>
            {dao.language && (
              <div className="flex items-center justify-between">
                <span className="text-[12px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Language
                </span>
                <span className="text-[12px] font-medium uppercase" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  {dao.language}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit dialog (admin only) */}
      {isAdmin && (
        <EditDaoProfileDialog
          open={editOpen}
          dao={dao}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); window.location.reload() }}
        />
      )}
    </div>
  )
}

// ── Edit Profile Dialog (admin) ──────────────────────────────────────────────

interface EditState {
  description: string
  purpose: string
  website: string
  language: string
  country: string
  region: string
  city: string
  isOnlineOnly: boolean
  focusAreas: string[]
  images: string[]
}

function EditDaoProfileDialog({
  open, dao, onClose, onSaved,
}: {
  open: boolean
  dao: import('./dao-types').Dao
  onClose: () => void
  onSaved: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<EditState>(() => buildForm(dao))

  // Re-sync when opening
  useEffect(() => {
    if (open) {
      setForm(buildForm(dao))
      setError(null)
    }
  }, [open, dao])

  function update(partial: Partial<EditState>) {
    setForm(prev => ({ ...prev, ...partial }))
  }

  function toggleFocusArea(area: string) {
    setForm(prev => ({
      ...prev,
      focusAreas: prev.focusAreas.includes(area)
        ? prev.focusAreas.filter(a => a !== area)
        : [...prev.focusAreas, area],
    }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await apiCall(`/api/daos/${dao.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: form.description || null,
          purpose: form.purpose || null,
          website: form.website || null,
          language: form.language || null,
          country: !form.isOnlineOnly && form.country ? form.country : null,
          region: !form.isOnlineOnly && form.region ? form.region : null,
          city: !form.isOnlineOnly && form.city ? form.city : null,
          isOnlineOnly: form.isOnlineOnly,
          focusAreas: form.focusAreas.length > 0 ? JSON.stringify(form.focusAreas) : null,
          images: form.images,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to save')
        return
      }
      onSaved()
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: 'var(--typography-fontfamily-sans)', fontSize: '15px', fontWeight: 700, color: 'var(--theme-text)' }}>
        Edit DAO Profile
      </DialogTitle>
      <DialogContent>
        <div className="space-y-4 pt-1">
          {error && (
            <div className="text-[12px] p-3 rounded-lg" style={{ color: 'var(--color-status-error)', background: 'rgba(245,101,101,0.08)', border: '1px solid rgba(245,101,101,0.2)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              {error}
            </div>
          )}

          <TextField
            label="Description (tagline)"
            fullWidth
            value={form.description}
            onChange={e => update({ description: e.target.value.slice(0, 160) })}
            helperText={`${form.description.length}/160`}
            size="small"
          />

          <TextField
            label="Purpose (Vereinszweck)"
            fullWidth
            multiline
            rows={3}
            value={form.purpose}
            onChange={e => update({ purpose: e.target.value.slice(0, 1000) })}
            helperText={`${form.purpose.length}/1000`}
            size="small"
          />

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Language (ISO 639-1)"
              value={form.language}
              onChange={e => update({ language: e.target.value.slice(0, 5) })}
              size="small"
            />
            <TextField
              label="Website"
              value={form.website}
              onChange={e => update({ website: e.target.value })}
              placeholder="https://…"
              size="small"
            />
          </div>

          <button
            type="button"
            onClick={() => update({ isOnlineOnly: !form.isOnlineOnly })}
            className="flex items-center gap-2 text-[12px]"
            style={{ color: form.isOnlineOnly ? 'var(--color-primary-50)' : 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            <Globe size={14} />
            <span>{form.isOnlineOnly ? 'Online / Global DAO' : 'Set as Online-only'}</span>
          </button>

          {!form.isOnlineOnly && (
            <div className="grid grid-cols-3 gap-2">
              <TextField label="Country (ISO)" value={form.country} onChange={e => update({ country: e.target.value.toUpperCase().slice(0, 2) })} placeholder="DE" size="small" />
              <TextField label="Region" value={form.region} onChange={e => update({ region: e.target.value })} size="small" />
              <TextField label="City" value={form.city} onChange={e => update({ city: e.target.value })} size="small" />
            </div>
          )}

          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Focus Areas
            </label>
            <div className="flex flex-wrap gap-1.5">
              {FOCUS_AREAS.map(area => {
                const active = form.focusAreas.includes(area)
                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => toggleFocusArea(area)}
                    className={cn('text-[11px] px-2.5 py-1 rounded-full transition-all')}
                    style={{
                      background: active ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                      color: active ? 'var(--color-primary-50)' : 'var(--theme-text)',
                      border: active ? '1px solid rgba(99,179,237,0.3)' : '1px solid transparent',
                      fontFamily: 'var(--typography-fontfamily-sans)',
                    }}
                  >
                    {area}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Gallery Images (up to 5)
            </label>
            <MultiImageUploadInput values={form.images} onChange={urls => update({ images: urls })} maxImages={5} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={onClose} disabled={saving} sx={{ textTransform: 'none', color: 'var(--theme-text)', borderColor: 'var(--theme-border)', borderRadius: '12px' }} variant="outlined">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              variant="contained"
              sx={{
                textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '12px', fontWeight: 700,
                fontFamily: 'var(--typography-fontfamily-sans)', borderRadius: '12px',
                backgroundColor: 'var(--color-status-success)', color: 'var(--color-neutral-black)',
                '&:hover': { opacity: 0.9 },
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function buildForm(dao: import('./dao-types').Dao): EditState {
  return {
    description: dao.description ?? '',
    purpose: dao.purpose ?? '',
    website: dao.website ?? '',
    language: dao.language ?? '',
    country: dao.country ?? '',
    region: dao.region ?? '',
    city: dao.city ?? '',
    isOnlineOnly: dao.isOnlineOnly ?? false,
    focusAreas: parseJsonField<string[]>(dao.focusAreas, []),
    images: parseJsonField<string[]>(dao.images, []),
  }
}

// ── Join CTA ──────────────────────────────────────────────────────────────────

function JoinCTA({ membershipType, onJoin }: { membershipType: MembershipType; onJoin: () => void }) {
  if (membershipType === 'OPEN') {
    return (
      <button
        onClick={onJoin}
        className="shrink-0 px-4 py-2 rounded-xl text-[12px] font-bold uppercase tracking-wider"
        style={{ background: 'var(--color-status-success)', color: 'white', fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        🟢 Join
      </button>
    )
  }
  if (membershipType === 'APPLICATION') {
    return (
      <button
        className="shrink-0 px-4 py-2 rounded-xl text-[12px] font-bold uppercase tracking-wider opacity-60 cursor-not-allowed"
        style={{ background: 'var(--color-warning-primary)', color: 'white', fontFamily: 'var(--typography-fontfamily-sans)' }}
        title="Application flow coming soon (FU-200-D)"
        disabled
      >
        📋 Apply
      </button>
    )
  }
  if (membershipType === 'TOKEN_GATED') {
    return (
      <button
        className="shrink-0 px-4 py-2 rounded-xl text-[12px] font-bold uppercase tracking-wider opacity-50 cursor-not-allowed"
        style={{ background: '#9F7AEA', color: 'white', fontFamily: 'var(--typography-fontfamily-sans)' }}
        disabled
        title="Token verification coming soon (FU-200-E)"
      >
        🪙 Token Gated
      </button>
    )
  }
  // INVITE_ONLY
  return (
    <button
      className="shrink-0 px-4 py-2 rounded-xl text-[12px] font-bold uppercase tracking-wider opacity-40 cursor-not-allowed"
      style={{ background: 'var(--color-status-error)', color: 'white', fontFamily: 'var(--typography-fontfamily-sans)' }}
      disabled
      title="Membership is by invitation only"
    >
      🔒 Invite Only
    </button>
  )
}
