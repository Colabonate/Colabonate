// Company Availability Setup – /sell/company/availability (ADR-110)
// Moved from /coop/delivery — delivery readiness is a company setup concern

import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Radio, Pause, Play, UserCheck, AlertCircle } from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { cn } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { usePageAnimation } from '../../hooks/usePageAnimation'

type AvailabilityStatus = 'ACTIVE' | 'INACTIVE' | 'PAUSED'

interface AvailabilityState {
  status: AvailabilityStatus
  substitutePubkey?: string
  partnerPubkey?: string
  notes?: string
}

export function SellCompanyAvailability() {
  const navigate = useNavigate()
  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '')
  const [availability, setAvailability] = useState<AvailabilityState>({ status: 'INACTIVE' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const pageRef = usePageAnimation([
    { selector: '.availability-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  const fetchAvailability = useCallback(async () => {
    if (!pubkey) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await apiCall(`/api/company/${pubkey}/availability`).catch(() => null)
      if (res?.ok) {
        const data = await res.json()
        if (data.availability) setAvailability(data.availability)
      }
    } finally {
      setLoading(false)
    }
  }, [pubkey])

  useEffect(() => { fetchAvailability() }, [fetchAvailability])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await apiCall(`/api/company/${pubkey}/availability`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(availability),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const STATUS_OPTIONS: Array<{ value: AvailabilityStatus; label: string; desc: string; icon: typeof Radio; color: string; bg: string }> = [
    {
      value: 'ACTIVE',
      label: 'Active',
      desc: 'Available for cooperation — partners can contact you.',
      icon: Play,
      color: 'var(--color-status-success)',
      bg: 'rgba(72,187,120,0.10)',
    },
    {
      value: 'INACTIVE',
      label: 'Inactive',
      desc: 'Not available — no cooperation requests will be visible.',
      icon: Radio,
      color: 'var(--color-neutral-5)',
      bg: 'rgba(113,128,150,0.08)',
    },
    {
      value: 'PAUSED',
      label: 'Paused',
      desc: 'Temporarily unavailable. A substitute partner can handle requests.',
      icon: Pause,
      color: 'var(--color-warning-primary)',
      bg: 'rgba(255,192,57,0.10)',
    },
  ]

  if (loading) {
    return (
      <PageContainer size="wide" spacing="lg">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div
              className="w-12 h-12 mx-auto mb-4 border-4 rounded-full border-t-transparent animate-spin"
              style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }}
            />
            <p className="text-(--theme-text-muted)">Loading availability settings...</p>
          </div>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="wide" spacing="lg" className="px-0.5! md:px-6! py-6!" ref={pageRef}>
      <div className="availability-animate">
        <PageHeader
          icon={<Radio size={18} />}
          title="Availability"
          subtitle="Configure your cooperation readiness and substitution"
          onBack={() => navigate('/sell/company')}
        />

        <div className="mt-6 flex flex-col gap-6 max-w-2xl">

          {/* Status Selection */}
          <div
            className="p-6 rounded-xl border"
            style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
          >
            <h3 className="text-[15px] font-semibold mb-4" style={{ color: 'var(--theme-text)' }}>
              Availability Status
            </h3>
            <div className="flex flex-col gap-3">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setAvailability(prev => ({ ...prev, status: opt.value }))}
                  className={cn(
                    'flex items-center gap-4 p-4 rounded-xl border cursor-pointer text-left',
                    'transition-all duration-150',
                  )}
                  style={{
                    background: availability.status === opt.value ? opt.bg : 'var(--theme-surface-secondary)',
                    border: availability.status === opt.value
                      ? `2px solid ${opt.color}`
                      : '2px solid transparent',
                  }}
                >
                  <div
                    className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
                    style={{ background: opt.bg }}
                  >
                    <opt.icon size={20} style={{ color: opt.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold mb-0.5" style={{ color: 'var(--theme-text)' }}>
                      {opt.label}
                    </div>
                    <div
                      className="text-[12px]"
                      style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                    >
                      {opt.desc}
                    </div>
                  </div>
                  <div
                    className="w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center"
                    style={{
                      borderColor: availability.status === opt.value ? opt.color : 'var(--theme-border)',
                      background: availability.status === opt.value ? opt.color : 'transparent',
                    }}
                  >
                    {availability.status === opt.value && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Substitute Partner (only when PAUSED) */}
          {availability.status === 'PAUSED' && (
            <div
              className="p-6 rounded-xl border"
              style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
            >
              <div className="flex items-center gap-2 mb-4">
                <UserCheck size={18} style={{ color: 'var(--color-warning-primary)' }} />
                <h3 className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                  Substitute Partner
                </h3>
              </div>
              <p
                className="text-[13px] mb-4"
                style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                Assign a trusted partner who will handle cooperation requests while you are paused.
              </p>
              <label
                className="block text-[12px] font-semibold mb-1.5"
                style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                Partner Nostr Public Key (npub or hex)
              </label>
              <input
                type="text"
                value={availability.substitutePubkey ?? ''}
                onChange={e => setAvailability(prev => ({ ...prev, substitutePubkey: e.target.value }))}
                placeholder="npub1… or hex pubkey"
                className="w-full px-3 py-2.5 rounded-lg border text-[13px] focus:outline-none"
                style={{
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface-secondary)',
                  color: 'var(--theme-text)',
                  fontFamily: 'var(--typography-fontfamily-mono, monospace)',
                }}
              />
            </div>
          )}

          {/* Notes */}
          <div
            className="p-6 rounded-xl border"
            style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
          >
            <h3 className="text-[15px] font-semibold mb-4" style={{ color: 'var(--theme-text)' }}>
              Notes
            </h3>
            <textarea
              value={availability.notes ?? ''}
              onChange={e => setAvailability(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Optional: Describe your availability, preferred cooperation types, or contact preferences…"
              rows={4}
              className="w-full px-3 py-2.5 rounded-lg border text-[13px] focus:outline-none resize-none"
              style={{
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface-secondary)',
                color: 'var(--theme-text)',
                fontFamily: 'var(--typography-fontfamily-sans)',
              }}
            />
          </div>

          {/* Info note */}
          <div
            className="flex items-start gap-3 p-4 rounded-xl"
            style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.20)' }}
          >
            <AlertCircle size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--color-primary-50)' }} />
            <p
              className="text-[12px] leading-relaxed"
              style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              Your availability status is visible to other users in the Coop Explore section.
              It is published to Nostr as part of your company profile (NIP-C, Kind 30414).
            </p>
          </div>

          {/* Save Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 rounded-lg text-[14px] font-semibold cursor-pointer transition-all duration-150 hover:opacity-90 active:scale-95 disabled:opacity-50"
              style={{
                background: 'var(--color-primary-50)',
                color: 'white',
                fontFamily: 'var(--typography-fontfamily-sans)',
              }}
            >
              {saving ? 'Saving…' : 'Save Availability'}
            </button>
            {saved && (
              <span
                className="text-[13px] font-medium"
                style={{ color: 'var(--color-status-success)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                Saved ✓
              </span>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
