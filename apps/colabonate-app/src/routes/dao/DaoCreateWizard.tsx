import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { Shield, Users, FileText, CheckCircle, ChevronRight, Lock, AlertCircle, Globe, Building2 } from 'lucide-react'
import { Button, TextField, Typography } from '@mui/material'
import { cn } from '@ds/utils'
import { DAO_TYPE_META, MEMBERSHIP_TYPE_META, FOCUS_AREAS, type DaoType, type MembershipType } from './dao-types'
import { MultiImageUploadInput } from '../../components/offers/MultiImageUploadInput'
import { useIsFoundationAdmin } from '../../hooks/useIsFoundationAdmin'

const WIZARD_STORAGE_KEY = 'dao-create-wizard-state'

const REQUIRED_SECTIONS = [
  'Purpose & Scope',
  'Membership Criteria',
  'Governance Rules',
  'Dispute Resolution Clause',
  'Sanction Levels',
  'Amendment Procedure',
  'Dissolution Clause',
]

interface ProfileState {
  description: string
  purpose: string
  daoType: DaoType
  membershipType: MembershipType
  language: string
  website: string
  isOnlineOnly: boolean
  country: string
  region: string
  city: string
  focusAreas: string[]
  images: string[]
}

interface WizardState {
  step: number
  daoName: string
  founders: string[]
  profile: ProfileState
  codexSections: Record<string, string>
  codexValidation: { valid: boolean; codexHash: string; missingSections: string[] } | null
}

const DEFAULT_PROFILE: ProfileState = {
  description: '',
  purpose: '',
  daoType: 'COMMUNITY',
  membershipType: 'OPEN',
  language: typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en',
  website: '',
  isOnlineOnly: false,
  country: '',
  region: '',
  city: '',
  focusAreas: [],
  images: [],
}

function loadWizardState(): WizardState | null {
  try {
    const saved = localStorage.getItem(WIZARD_STORAGE_KEY)
    if (!saved) return null
    return JSON.parse(saved) as WizardState
  } catch {
    return null
  }
}

function saveWizardState(state: WizardState) {
  try {
    localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage full or unavailable
  }
}

function clearWizardState() {
  try {
    localStorage.removeItem(WIZARD_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function DaoCreateWizard() {
  const navigate = useNavigate()
  // Launch-scope restriction: community DAO creation is temporarily limited
  // to Colabonate Foundation admins (server-enforced in dao-voting.ts via
  // requireFoundationAdminBySession) — this mirrors that gate in the UI so
  // non-admins don't fill out the whole wizard before hitting a 403.
  const isFoundationAdmin = useIsFoundationAdmin(localStorage.getItem('pubkey'))
  const savedState = loadWizardState()
  const [step, setStep] = useState(savedState?.step ?? 0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [daoName, setDaoName] = useState(savedState?.daoName ?? '')
  const [founders, setFounders] = useState<string[]>(savedState?.founders ?? [''])
  const [coSignatures] = useState<Array<{ pubkey: string; event: string }>>([])
  const [profile, setProfile] = useState<ProfileState>(savedState?.profile ?? DEFAULT_PROFILE)
  const [codexSections, setCodexSections] = useState<Record<string, string>>(
    savedState?.codexSections ?? Object.fromEntries(REQUIRED_SECTIONS.map(s => [s, '']))
  )
  const [codexValidation, setCodexValidation] = useState<{ valid: boolean; codexHash: string; missingSections: string[] } | null>(savedState?.codexValidation ?? null)

  function updateProfile(partial: Partial<ProfileState>) {
    setProfile(prev => ({ ...prev, ...partial }))
  }

  function toggleFocusArea(area: string) {
    setProfile(prev => ({
      ...prev,
      focusAreas: prev.focusAreas.includes(area)
        ? prev.focusAreas.filter(a => a !== area)
        : [...prev.focusAreas, area],
    }))
  }

  useEffect(() => {
    saveWizardState({ step, daoName, founders, profile, codexSections, codexValidation })
  }, [step, daoName, founders, profile, codexSections, codexValidation])

  const containerRef = usePageAnimation([
    { selector: '.wizard-animate', from: { duration: 0.5, stagger: 0.12, y: 20 } },
  ])

  function updateFounder(index: number, value: string) {
    const updated = [...founders]
    updated[index] = value
    setFounders(updated)
  }

  function addFounder() {
    setFounders([...founders, ''])
  }

  function removeFounder(index: number) {
    if (founders.length <= 1) return
    setFounders(founders.filter((_, i) => i !== index))
  }

  function buildCodexBody(): string {
    return REQUIRED_SECTIONS.map(section => {
      const content = codexSections[section] ?? ''
      return `## ${section}\n\n${content}`
    }).join('\n\n')
  }

  async function validateCodex() {
    const body = buildCodexBody()
    try {
      const res = await apiCall('/api/daos/validate-codex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codexBody: body }),
      })
      const data = await res.json()
      setCodexValidation(data)
    } catch (err) {
      console.error('Codex validation failed:', err)
      setError('Codex validation failed')
    }
  }

  async function createDao() {
    setCreating(true)
    setError(null)

    try {
      const pubkey = localStorage.getItem('pubkey')
      if (!pubkey) {
        setError('Please sign in with Nostr first')
        return
      }

      const codexBody = buildCodexBody()
      const allFounders = founders.filter(f => f.trim().length > 0)

      if (allFounders.length < 5) {
        setError('At least 5 founders are required')
        return
      }

      if (!allFounders.includes(pubkey)) {
        allFounders.unshift(pubkey)
      }

      const res = await apiCall('/api/daos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: daoName,
          codexBody,
          codexUrl: '',
          codexVersion: '1.0.0',
          codexHash: codexValidation?.codexHash,
          founders: allFounders,
          coSignatures,
          governanceConfig: {
            proposalValidationStrategy: 'colpoints_threshold',
            votingStrategies: '["colpoints"]',
            minVotingPeriodSeconds: 7 * 86400,
            maxVotingPeriodSeconds: 30 * 86400,
          },
          // ADR-200: profile & location
          description: profile.description || undefined,
          purpose: profile.purpose || undefined,
          daoType: profile.daoType,
          membershipType: profile.membershipType,
          focusAreas: profile.focusAreas.length > 0 ? JSON.stringify(profile.focusAreas) : undefined,
          language: profile.language || undefined,
          website: profile.website || undefined,
          isOnlineOnly: profile.isOnlineOnly,
          country: !profile.isOnlineOnly && profile.country ? profile.country : undefined,
          region: !profile.isOnlineOnly && profile.region ? profile.region : undefined,
          city: !profile.isOnlineOnly && profile.city ? profile.city : undefined,
          images: profile.images.length > 0 ? profile.images : undefined,
        }),
      })

      const data = await res.json()

      if (data.dao) {
        clearWizardState()
        navigate(`/dao/${data.dao.id}`)
      } else {
        setError(data.error || 'Failed to create DAO')
      }
    } catch (err) {
      console.error('Failed to create DAO:', err)
      setError('Failed to create DAO')
    } finally {
      setCreating(false)
    }
  }

  const filledSections = REQUIRED_SECTIONS.filter(s => (codexSections[s] ?? '').trim().length > 0).length
  const validFounders = founders.filter(f => f.trim().length > 0).length

  const steps = [
    { label: 'Founding Assembly', icon: <Users size={16} /> },
    { label: 'Profile & Location', icon: <Building2 size={16} /> },
    { label: 'Codex Editor', icon: <FileText size={16} /> },
    { label: 'Validation', icon: <CheckCircle size={16} /> },
    { label: 'COLA Stake', icon: <Lock size={16} /> },
    { label: 'Publish', icon: <Shield size={16} /> },
  ]

  if (!isFoundationAdmin) {
    return (
      <PageContainer size="wide" spacing="lg" className="pt-0!">
        <div className="max-w-2xl mx-auto space-y-6">
          <PageHeader
            icon={<Shield size={18} />}
            title="Create Community DAO"
            subtitle="Launch your own DAO with a custom codex"
            onBack={() => navigate('/dao')}
          />
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Lock size={28} style={{ color: 'var(--theme-text-muted)' }} />
            <Typography variant="body1" style={{ color: 'var(--theme-text-primary)' }}>
              DAO creation is temporarily limited
            </Typography>
            <Typography variant="body2" style={{ color: 'var(--theme-text-muted)', maxWidth: 420 }}>
              While Colabonate is in its launch phase, only Foundation admins can create a new DAO. You can still join existing DAOs.
            </Typography>
          </div>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="wide" spacing="lg" className="pt-0!">
      <div ref={containerRef} className="max-w-2xl mx-auto space-y-6">
        <PageHeader
          icon={<Shield size={18} />}
          title="Create Community DAO"
          subtitle="Launch your own DAO with a custom codex"
          onBack={() => navigate('/dao')}
        />

        {savedState && step > 0 && (
          <div className="flex items-center justify-between wizard-animate">
            <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Resumed from previous session
            </span>
            <button
              onClick={() => { clearWizardState(); window.location.reload() }}
              className="text-[11px] font-medium px-2 py-1 rounded"
              style={{ color: 'var(--color-status-error)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              Discard
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 wizard-animate overflow-x-auto">
          {steps.map((s, i) => (
            <div
              key={s.label}
              className="flex items-center gap-1 flex-1 min-w-0"
            >
              <div
                className="flex items-center gap-1.5 px-1.5 sm:px-2 py-1.5 rounded-lg text-[11px] font-medium w-full min-w-0"
                style={{
                  background: i <= step ? 'rgba(99,179,237,0.12)' : 'var(--theme-surface-secondary)',
                  color: i <= step ? 'var(--color-primary-50)' : 'var(--theme-text-muted)',
                  border: i === step ? '1px solid rgba(99,179,237,0.3)' : '1px solid transparent',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                }}
              >
                <span className="shrink-0">{s.icon}</span>
                <span className="hidden sm:inline truncate">{s.label}</span>
                <span className="sm:hidden text-[10px] font-bold">{i + 1}</span>
              </div>
              {i < steps.length - 1 && (
                <ChevronRight size={12} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>

        {error && (
          <div
            className="flex items-center gap-3 p-4 rounded-lg wizard-animate"
            style={{
              background: 'rgba(245,101,101,0.08)',
              border: '1px solid rgba(245,101,101,0.2)',
            }}
          >
            <AlertCircle size={16} style={{ color: 'var(--color-status-error)' }} />
            <span className="text-[13px]" style={{ color: 'var(--color-status-error)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              {error}
            </span>
          </div>
        )}

        {/* Step 0: Founding Assembly */}
        {step === 0 && (

          <div
            className="p-4 sm:p-6 rounded-xl space-y-4 wizard-animate"
            style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
          >
            <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Founding Assembly
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Add at least 5 founding members (Nostr pubkeys). You are automatically included.
            </Typography>
            <TextField
              label="DAO Name"
              fullWidth
              value={daoName}
              onChange={e => setDaoName(e.target.value)}
              placeholder="e.g. Colabonate Art Guild"
              disabled={creating}
            />
            {founders.map((founder, i) => (
              <div key={i} className="flex flex-col sm:flex-row gap-2">
                <TextField
                  label={`Founder ${i + 1} Pubkey`}
                  fullWidth
                  value={founder}
                  onChange={e => updateFounder(i, e.target.value)}
                  placeholder="Nostr hex pubkey"
                  disabled={creating}
                  size="small"
                />
                {founders.length > 1 && (
                  <Button
                    onClick={() => removeFounder(i)}
                    size="small"
                    sx={{ minWidth: 'auto', color: 'var(--color-status-error)' }}
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
            <Button
              onClick={addFounder}
              size="small"
              sx={{ textTransform: 'none', color: 'var(--color-primary-50)' }}
            >
              + Add Founder
            </Button>
            <div className="flex justify-end pt-2">
              <Button
                variant="contained"
                onClick={() => { setError(null); setStep(1) }}
                disabled={!daoName.trim() || validFounders < 1}
                sx={{
                  py: 1.5, borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                  backgroundColor: 'var(--color-primary-50)', color: 'white',
                  '&:hover': { backgroundColor: 'var(--color-primary-50)', opacity: 0.9 },
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step 1: Profile & Location (ADR-200) */}
        {step === 1 && (
          <div
            className="p-4 sm:p-6 rounded-xl space-y-5 wizard-animate"
            style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
          >
            <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Profile & Location
            </Typography>

            {/* Description */}
            <TextField
              label="Description (tagline)"
              fullWidth
              value={profile.description}
              onChange={e => updateProfile({ description: e.target.value.slice(0, 160) })}
              placeholder="One-line tagline for your DAO (max 160 chars)"
              helperText={`${profile.description.length}/160`}
              disabled={creating}
              size="small"
              required
            />

            {/* Purpose */}
            <TextField
              label="Purpose (Vereinszweck)"
              fullWidth
              multiline
              rows={3}
              value={profile.purpose}
              onChange={e => updateProfile({ purpose: e.target.value.slice(0, 1000) })}
              placeholder="What does your DAO exist to do? (max 1000 chars)"
              helperText={`${profile.purpose.length}/1000`}
              disabled={creating}
              size="small"
            />

            {/* DAO Type */}
            <div>
              <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                DAO Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(Object.keys(DAO_TYPE_META) as DaoType[]).map(type => {
                  const meta = DAO_TYPE_META[type]
                  const active = profile.daoType === type
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => updateProfile({ daoType: type })}
                      className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-[11px] font-medium transition-all"
                      style={{
                        background: active ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                        border: active ? '1px solid rgba(99,179,237,0.4)' : '1px solid transparent',
                        color: active ? 'var(--color-primary-50)' : 'var(--theme-text)',
                        fontFamily: 'var(--typography-fontfamily-sans)',
                      }}
                    >
                      <span className="text-base">{meta.emoji}</span>
                      <span>{meta.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Membership Type */}
            <div>
              <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                Membership
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(MEMBERSHIP_TYPE_META) as MembershipType[]).map(type => {
                  const meta = MEMBERSHIP_TYPE_META[type]
                  const active = profile.membershipType === type
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => updateProfile({ membershipType: type })}
                      className="py-2 px-3 rounded-lg text-[11px] font-medium text-left transition-all"
                      style={{
                        background: active ? meta.bg : 'var(--theme-bg-subtle)',
                        border: active ? `1px solid ${meta.color}44` : '1px solid transparent',
                        color: active ? meta.color : 'var(--theme-text)',
                        fontFamily: 'var(--typography-fontfamily-sans)',
                      }}
                    >
                      {meta.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Language + Website */}
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Language (ISO 639-1)"
                value={profile.language}
                onChange={e => updateProfile({ language: e.target.value.slice(0, 5) })}
                placeholder="de, en, fr…"
                disabled={creating}
                size="small"
              />
              <TextField
                label="Website (optional)"
                value={profile.website}
                onChange={e => updateProfile({ website: e.target.value })}
                placeholder="https://…"
                disabled={creating}
                size="small"
              />
            </div>

            {/* Location */}
            <div>
              <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                Location
              </label>
              <button
                type="button"
                onClick={() => updateProfile({ isOnlineOnly: !profile.isOnlineOnly })}
                className="flex items-center gap-2 mb-3 text-[12px]"
                style={{ color: profile.isOnlineOnly ? 'var(--color-primary-50)' : 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                <Globe size={14} />
                <span>{profile.isOnlineOnly ? 'Online / Global DAO' : 'Set as Online-only'}</span>
              </button>
              {!profile.isOnlineOnly && (
                <div className="grid grid-cols-3 gap-2">
                  <TextField
                    label="Country (ISO)"
                    value={profile.country}
                    onChange={e => updateProfile({ country: e.target.value.toUpperCase().slice(0, 2) })}
                    placeholder="DE"
                    disabled={creating}
                    size="small"
                  />
                  <TextField
                    label="Region"
                    value={profile.region}
                    onChange={e => updateProfile({ region: e.target.value })}
                    placeholder="Bayern"
                    disabled={creating}
                    size="small"
                  />
                  <TextField
                    label="City"
                    value={profile.city}
                    onChange={e => updateProfile({ city: e.target.value })}
                    placeholder="München"
                    disabled={creating}
                    size="small"
                  />
                </div>
              )}
            </div>

            {/* Focus Areas */}
            <div>
              <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                Focus Areas <span style={{ color: 'var(--theme-text-muted)' }}>(optional)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {FOCUS_AREAS.map(area => {
                  const active = profile.focusAreas.includes(area)
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

            {/* Gallery Images */}
            <div>
              <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                Gallery Images <span style={{ color: 'var(--theme-text-muted)' }}>(optional, up to 5)</span>
              </label>
              <MultiImageUploadInput
                values={profile.images}
                onChange={urls => updateProfile({ images: urls })}
                maxImages={5}
              />
            </div>

            <div className="flex justify-between pt-2">
              <Button
                variant="outlined"
                onClick={() => setStep(0)}
                sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--theme-text)', borderColor: 'var(--theme-border)' }}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={() => { setError(null); setStep(2) }}
                disabled={!profile.description.trim()}
                sx={{
                  py: 1.5, borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                  backgroundColor: 'var(--color-primary-50)', color: 'white',
                  '&:hover': { backgroundColor: 'var(--color-primary-50)', opacity: 0.9 },
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Codex Editor */}
        {step === 2 && (
          <div
            className="p-4 sm:p-6 rounded-xl space-y-4 wizard-animate"
            style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
          >
            <div className="flex items-center justify-between">
              <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                Codex Editor
              </Typography>
              <span className="text-[11px] font-medium px-2 py-1 rounded-md" style={{
                background: filledSections === 7 ? 'rgba(72,187,120,0.12)' : 'rgba(255,192,57,0.12)',
                color: filledSections === 7 ? 'var(--color-status-success)' : 'var(--color-warning-primary)',
                fontFamily: 'var(--typography-fontfamily-sans)',
              }}>
                {filledSections}/7 sections
              </span>
            </div>
            {REQUIRED_SECTIONS.map(section => (
              <div key={section}>
                <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  {section}
                  {(codexSections[section] ?? '').trim() ? ' ✓' : ''}
                </label>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  value={codexSections[section] ?? ''}
                  onChange={e => setCodexSections(prev => ({ ...prev, [section]: e.target.value }))}
                  placeholder={`Write the ${section.toLowerCase()} section...`}
                  disabled={creating}
                  size="small"
                />
              </div>
            ))}
            <div className="flex justify-between pt-2">
              <Button
                variant="outlined"
                onClick={() => setStep(1)}
                sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--theme-text)', borderColor: 'var(--theme-border)' }}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={() => { setError(null); setStep(3) }}
                disabled={filledSections < 7}
                sx={{
                  py: 1.5, borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                  backgroundColor: 'var(--color-primary-50)', color: 'white',
                  '&:hover': { backgroundColor: 'var(--color-primary-50)', opacity: 0.9 },
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Validation */}
        {step === 3 && (
          <div
            className="p-4 sm:p-6 rounded-xl space-y-4 wizard-animate"
            style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
          >
            <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Validation & Hash
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              The server validates all 7 sections and computes the SHA-256 hash.
            </Typography>
            {!codexValidation && (
              <Button
                variant="contained"
                onClick={validateCodex}
                sx={{
                  py: 1.5, borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                  backgroundColor: 'var(--color-primary-50)', color: 'white',
                  '&:hover': { backgroundColor: 'var(--color-primary-50)', opacity: 0.9 },
                }}
              >
                Validate Codex
              </Button>
            )}
            {codexValidation && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {codexValidation.valid ? (
                    <CheckCircle size={16} style={{ color: 'var(--color-status-success)' }} />
                  ) : (
                    <AlertCircle size={16} style={{ color: 'var(--color-status-error)' }} />
                  )}
                  <span className="text-[13px] font-medium" style={{ color: codexValidation.valid ? 'var(--color-status-success)' : 'var(--color-status-error)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                    {codexValidation.valid ? 'Codex is valid' : 'Missing sections'}
                  </span>
                </div>
                {codexValidation.missingSections.length > 0 && (
                  <div className="text-[12px]" style={{ color: 'var(--color-status-error)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                    Missing: {codexValidation.missingSections.join(', ')}
                  </div>
                )}
                {codexValidation.valid && (
                  <div className="p-3 rounded-lg" style={{ background: 'var(--theme-surface-secondary)', border: '1px solid var(--theme-border)' }}>
                    <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                      SHA-256 Hash
                    </span>
                    <span className="font-mono text-[12px] break-all" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                      {codexValidation.codexHash}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-between pt-2">
              <Button
                variant="outlined"
                onClick={() => setStep(2)}
                sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--theme-text)', borderColor: 'var(--theme-border)' }}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={() => { setError(null); setStep(4) }}
                disabled={!codexValidation?.valid}
                sx={{
                  py: 1.5, borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                  backgroundColor: 'var(--color-primary-50)', color: 'white',
                  '&:hover': { backgroundColor: 'var(--color-primary-50)', opacity: 0.9 },
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: COLA Stake (Phase 4 stub) */}
        {step === 4 && (
          <div
            className="p-4 sm:p-6 rounded-xl space-y-4 wizard-animate"
            style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
          >
            <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              COLA Stake
            </Typography>
            <Typography sx={{ fontSize: '12px', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Each founding member stakes COLA tokens as economic commitment. This step will be available in Phase 4.
            </Typography>
            <div
              className="p-4 rounded-lg"
              style={{ background: 'rgba(255,192,57,0.06)', border: '1px solid rgba(255,192,57,0.2)' }}
            >
              <span className="text-[12px]" style={{ color: 'var(--color-warning-primary)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                COLA staking is not yet available. You can proceed without staking.
              </span>
            </div>
            <div className="flex justify-between pt-2">
              <Button
                variant="outlined"
                onClick={() => setStep(3)}
                sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--theme-text)', borderColor: 'var(--theme-border)' }}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={() => { setError(null); setStep(5) }}
                sx={{
                  py: 1.5, borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                  backgroundColor: 'var(--color-primary-50)', color: 'white',
                  '&:hover': { backgroundColor: 'var(--color-primary-50)', opacity: 0.9 },
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step 5: Publish */}
        {step === 5 && (
          <div
            className="p-4 sm:p-6 rounded-xl space-y-4 wizard-animate"
            style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
          >
            <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Review & Publish
            </Typography>
            <div className="space-y-3 text-[13px]" style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}>
              <div className="flex justify-between">
                <span style={{ color: 'var(--theme-text-muted)' }}>DAO Name</span>
                <span style={{ color: 'var(--theme-text)' }}>{daoName}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--theme-text-muted)' }}>Type</span>
                <span style={{ color: 'var(--theme-text)' }}>{DAO_TYPE_META[profile.daoType].emoji} {DAO_TYPE_META[profile.daoType].label}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--theme-text-muted)' }}>Membership</span>
                <span style={{ color: 'var(--theme-text)' }}>{MEMBERSHIP_TYPE_META[profile.membershipType].label}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--theme-text-muted)' }}>Location</span>
                <span style={{ color: 'var(--theme-text)' }}>
                  {profile.isOnlineOnly ? '🌐 Online' : [profile.city, profile.country].filter(Boolean).join(', ') || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--theme-text-muted)' }}>Founders</span>
                <span style={{ color: 'var(--theme-text)' }}>{validFounders} pubkeys</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--theme-text-muted)' }}>Codex Sections</span>
                <span style={{ color: 'var(--theme-text)' }}>{filledSections}/7</span>
              </div>
              {codexValidation && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--theme-text-muted)' }}>Codex Hash</span>
                  <span className="font-mono" style={{ color: 'var(--theme-text)' }}>{codexValidation.codexHash.slice(0, 24)}...</span>
                </div>
              )}
              <div className="flex justify-between">
                <span style={{ color: 'var(--theme-text-muted)' }}>COLA Stake</span>
                <span style={{ color: 'var(--color-warning-primary)' }}>Phase 4</span>
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button
                variant="outlined"
                onClick={() => setStep(4)}
                sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--theme-text)', borderColor: 'var(--theme-border)' }}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={createDao}
                disabled={creating}
                sx={{
                  py: 1.5, borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                  backgroundColor: 'var(--color-status-success)', color: 'var(--color-neutral-black)',
                  '&:hover': { opacity: 0.9 },
                }}
              >
                {creating ? 'Creating...' : 'Create DAO'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  )
}
