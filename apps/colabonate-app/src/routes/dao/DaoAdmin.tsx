import { useState, useEffect, useMemo } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import { Modal, ModalContent, ModalActions } from '@ds/ui'
import { apiCall } from '../../lib/api'
import { adminApiCall } from '../../lib/nostr-admin-auth'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { cn } from '@ds/utils'
import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import { UserPlus, Users, UserMinus, Shield, MessageSquare, CheckCircle, Clock } from 'lucide-react'
import type { DaoMember } from '../council/council-types'

type AdminSubView = 'members' | 'config' | 'bootstrap' | 'governance'

function getAdminSubView(pathname: string): AdminSubView {
  if (pathname.endsWith('/admin/config')) return 'config'
  if (pathname.endsWith('/admin/bootstrap')) return 'bootstrap'
  if (pathname.endsWith('/admin/governance')) return 'governance'
  return 'members'
}

export function DaoAdmin() {
  const location = useLocation()
  const containerRef = usePageAnimation([
    { selector: '.admin-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  const subView = useMemo(
    () => getAdminSubView(location.pathname),
    [location.pathname],
  )

  return (
    <div ref={containerRef} className="admin-animate space-y-6">
      {subView === 'members' && <AdminMembersContent />}
      {subView === 'config' && <AdminConfigContent />}
      {subView === 'bootstrap' && <AdminBootstrapContent />}
      {subView === 'governance' && <AdminGovernanceContent />}
    </div>
  )
}

function AdminMembersContent() {
  const { formatTime } = useTranslation()
  const [members, setMembers] = useState<DaoMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [invitePubkey, setInvitePubkey] = useState('')
  const [inviteRole, setInviteRole] = useState<'ARBITRATOR' | 'MEDIATOR'>('ARBITRATOR')
  const [inviting, setInviting] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })
  const [inviteError, setInviteError] = useState<string | null>(null)

  useEffect(() => {
    loadMembers()
  }, [])

  const loadMembers = async () => {
    setLoading(true)
    try {
      const res = await apiCall('/api/dao/foundation/members')
      const data = await res.json()
      setMembers(data.members || [])
    } catch (err) {
      console.error('Failed to load members:', err)
      setError('Failed to load members')
    } finally {
      setLoading(false)
    }
  }

  const handleInvite = async () => {
    if (!invitePubkey.trim()) return
    setInviting(true)
    setInviteError(null)
    try {
      const res = await adminApiCall('/api/dao/foundation/members', {
        method: 'POST',
        body: JSON.stringify({ pubkey: invitePubkey.trim(), role: inviteRole }),
      })
      if (res.ok) {
        setInvitePubkey('')
        setShowInviteModal(false)
        loadMembers()
        setSnackbar({ open: true, message: 'Member invited successfully', severity: 'success' })
      } else {
        const err = await res.json()
        setInviteError(err.error || 'Failed to invite member')
      }
    } catch (err) {
      console.error('Failed to invite:', err)
      setInviteError('Failed to invite member')
    } finally {
      setInviting(false)
    }
  }

  const handleRevoke = async (pubkey: string) => {
    setRevoking(pubkey)
    try {
      const res = await adminApiCall(`/api/dao/foundation/members/${pubkey}/revoke`, {
        method: 'PATCH',
      })
      if (res.ok) {
        loadMembers()
        setSnackbar({ open: true, message: 'Member revoked successfully', severity: 'success' })
      } else {
        const err = await res.json()
        setSnackbar({ open: true, message: err.error || 'Failed to revoke member', severity: 'error' })
      }
    } catch (err) {
      console.error('Failed to revoke:', err)
      setSnackbar({ open: true, message: 'Failed to revoke member', severity: 'error' })
    } finally {
      setRevoking(null)
    }
  }

  const statusStyles = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return { bg: 'rgba(72,187,120,0.15)', color: '#16a34a' }
      case 'PENDING':
        return { bg: 'rgba(250,204,21,0.15)', color: '#ca8a04' }
      case 'REVOKED':
        return { bg: 'rgba(239,68,68,0.12)', color: 'var(--color-status-error)' }
      default:
        return { bg: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)' }
    }
  }

  const roleBadgeColor = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return { bg: 'rgba(147,51,234,0.15)', color: '#7c3aed' }
      case 'ARBITRATOR':
        return { bg: 'rgba(59,130,246,0.15)', color: '#2563eb' }
      case 'MEDIATOR':
        return { bg: 'rgba(249,115,22,0.15)', color: '#ea580c' }
      default:
        return { bg: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)' }
    }
  }

  const SkeletonRow = () => (
    <tr className="border-t" style={{ borderColor: 'var(--theme-border)' }}>
      <td className="px-4 py-3"><div className="h-3 w-32 rounded animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
      <td className="px-4 py-3"><div className="h-5 w-20 rounded-full animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
      <td className="px-4 py-3"><div className="h-5 w-16 rounded-full animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 rounded animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 rounded animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
      <td className="px-4 py-3"><div className="h-5 w-16 rounded animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
    </tr>
  )

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowInviteModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-all duration-200 hover:opacity-90 cursor-pointer"
          style={{ background: 'var(--color-accent)' }}
        >
          <UserPlus size={16} />
          Invite Member
        </button>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{
        border: '1px solid var(--theme-border)',
        background: 'var(--theme-surface)',
      }}>
        {error ? (
          <div className="p-6 text-center" style={{ color: 'var(--color-status-error)' }}>
            {error}
          </div>
        ) : (
        <table className="w-full text-sm">
          <thead className="text-left" style={{ background: 'var(--theme-surface-secondary)' }}>
            <tr>
              <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Pubkey</th>
              <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Role</th>
              <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Status</th>
              <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Invited By</th>
              <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Accepted</th>
              <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [1, 2, 3, 4].map(i => <SkeletonRow key={i} />)
            ) : (
              <>
                {members.map(member => (
                  <tr
                    key={member.id}
                    className="border-t transition-colors duration-200 hover:bg-[var(--theme-surface-secondary)]"
                    style={{ borderColor: 'var(--theme-border)' }}
                  >
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--theme-text)' }}>
                      {member.pubkey.slice(0, 16)}…
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex px-2 py-1 rounded-full text-xs font-medium"
                        style={roleBadgeColor(member.role)}
                      >
                        {member.role === 'ADMIN' && <Shield size={10} className="mr-1" />}
                        {member.role === 'ARBITRATOR' && <Shield size={10} className="mr-1" />}
                        {member.role === 'MEDIATOR' && <MessageSquare size={10} className="mr-1" />}
                        {member.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <span
                        className="inline-flex px-2 py-1 rounded-full text-xs font-medium"
                        style={statusStyles(member.status)}
                      >
                        {member.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                      {member.invitedBy ? `${member.invitedBy.slice(0, 8)}…` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                      {member.acceptedAt ? formatTime(new Date(member.acceptedAt), { day: '2-digit', month: 'short' }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {member.status !== 'REVOKED' && (
                        <button
                          onClick={() => handleRevoke(member.pubkey)}
                          disabled={revoking === member.pubkey}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors duration-200 hover:bg-red-50 disabled:opacity-50 cursor-pointer"
                          style={{ color: 'var(--color-status-error)' }}
                        >
                          <UserMinus size={14} />
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center">
                        <div className="flex items-center justify-center w-12 h-12 rounded-xl mb-3" style={{ background: 'rgba(99,179,237,0.12)' }}>
                          <Users size={24} style={{ color: 'var(--color-primary-50)' }} />
                        </div>
                        <p className="text-[14px] font-medium mb-1" style={{ color: 'var(--theme-text)' }}>
                          No members yet
                        </p>
                        <p className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
                          Invite arbitrators and mediators to join the council.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
        )}
      </div>

      <Modal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Invite New Member"
        actions={
          <ModalActions
            cancel={{
              onClick: () => setShowInviteModal(false),
              children: 'Cancel',
            }}
            confirm={{
              onClick: handleInvite,
              disabled: inviting || !invitePubkey.trim(),
              loading: inviting,
              children: 'Send Invite',
              startIcon: <UserPlus size={16} />,
            }}
          />
        }
        size="sm"
      >
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--theme-text)' }}>
                Nostr Pubkey
              </label>
              <input
                type="text"
                value={invitePubkey}
                onChange={e => setInvitePubkey(e.target.value)}
                placeholder="npub1..."
                className="w-full px-3 py-2.5 rounded-lg border text-sm font-mono transition-colors duration-200 focus:outline-none focus:border-[var(--color-accent)]"
                style={{
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface-secondary)',
                  color: 'var(--theme-text)',
                }}
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--theme-text)' }}>
                Role
              </label>
              <div className="flex gap-3">
                {(['ARBITRATOR', 'MEDIATOR'] as const).map(role => (
                  <label
                    key={role}
                    className={cn('flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all duration-200')}
                    style={{
                      border: inviteRole === role ? '2px solid var(--color-accent)' : '1px solid var(--theme-border)',
                      background: inviteRole === role ? 'rgba(99,179,237,0.08)' : 'var(--theme-surface-secondary)',
                    }}
                  >
                    <input
                      type="radio"
                      name="inviteRole"
                      value={role}
                      checked={inviteRole === role}
                      onChange={() => setInviteRole(role)}
                      className="sr-only"
                    />
                    {role === 'ARBITRATOR' && <Shield size={16} style={{ color: 'var(--color-primary-50)' }} />}
                    {role === 'MEDIATOR' && <MessageSquare size={16} style={{ color: 'var(--color-primary-50)' }} />}
                    <span className="text-[13px] font-medium" style={{ color: 'var(--theme-text)' }}>
                      {role.charAt(0) + role.slice(1).toLowerCase()}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {inviteError && (
              <div
                className="rounded-lg p-3 text-sm"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  color: 'var(--color-status-error)',
                }}
              >
                {inviteError}
              </div>
            )}
          </div>
        </ModalContent>
      </Modal>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} sx={{ borderRadius: 2 }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </div>
  )
}

function AdminConfigContent() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quorumType, setQuorumType] = useState<'SINGLE' | 'MAJORITY' | 'THRESHOLD'>('SINGLE')
  const [thresholdN, setThresholdN] = useState(1)
  const [coolingOffDays, setCoolingOffDays] = useState(7)
  const [verdictDeadlineHours, setVerdictDeadlineHours] = useState(48)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const res = await apiCall('/api/dao/foundation/config')
      const data = await res.json()
      if (data.config) {
        setQuorumType(data.config.quorumType)
        setThresholdN(data.config.thresholdN)
        setCoolingOffDays(data.config.coolingOffDays)
        setVerdictDeadlineHours(data.config.verdictDeadlineHours)
      }
    } catch (err) {
      console.error('Failed to load config:', err)
      setError('Failed to load configuration')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await adminApiCall('/api/dao/foundation/config', {
        method: 'PATCH',
        body: JSON.stringify({ quorumType, thresholdN, coolingOffDays, verdictDeadlineHours }),
      })
      if (res.ok) {
        setSnackbar({ open: true, message: 'Configuration saved successfully', severity: 'success' })
        loadConfig()
      } else {
        const err = await res.json()
        setSnackbar({ open: true, message: err.error || 'Failed to save configuration', severity: 'error' })
      }
    } catch (err) {
      console.error('Failed to save config:', err)
      setSnackbar({ open: true, message: 'Failed to save configuration', severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const QUORUM_OPTIONS = [
    { value: 'SINGLE' as const, label: 'Single (1 verdict)', desc: 'Any arbitrator can resolve (bootstrap mode)', icon: Shield },
    { value: 'MAJORITY' as const, label: 'Majority (>50%)', desc: 'More than half of active arbitrators required', icon: Users },
    { value: 'THRESHOLD' as const, label: 'Fixed Threshold (N)', desc: 'Exactly N arbitrators must vote', icon: CheckCircle },
  ]

  const SkeletonCard = () => (
    <div className="rounded-xl border p-5 animate-pulse" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}>
      <div className="h-5 w-32 rounded mb-4" style={{ background: 'var(--theme-surface-secondary)' }} />
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 rounded-lg" style={{ background: 'var(--theme-surface-secondary)' }} />
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="space-y-6">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <div className="rounded-xl border p-4" style={{ border: '1px solid var(--color-status-error)', background: 'rgba(239,68,68,0.08)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      ) : (
        <>
          <div className="rounded-xl border p-5" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}>
            <h3 className="text-[14px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--theme-text-muted)' }}>
              Quorum Model
            </h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
              Select how many arbitrators must agree before a dispute is resolved
            </p>
            <div className="space-y-3">
              {QUORUM_OPTIONS.map(({ value, label, desc, icon: Icon }) => (
                <label
                  key={value}
                  className={cn('flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200')}
                  style={{
                    border: quorumType === value ? '2px solid var(--color-accent)' : '1px solid var(--theme-border)',
                    background: quorumType === value ? 'rgba(99,179,237,0.06)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="quorumType"
                    value={value}
                    checked={quorumType === value}
                    onChange={() => setQuorumType(value)}
                    className="sr-only"
                  />
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0" style={{
                    background: quorumType === value ? 'rgba(99,179,237,0.12)' : 'var(--theme-surface-secondary)',
                  }}>
                    <Icon size={18} style={{ color: quorumType === value ? 'var(--color-primary-50)' : 'var(--theme-text-muted)' }} />
                  </div>
                  <div>
                    <div className="font-medium text-sm" style={{ color: 'var(--theme-text)' }}>{label}</div>
                    <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {quorumType === 'THRESHOLD' && (
            <div className="rounded-xl border p-5 transition-all duration-300" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}>
              <h3 className="text-[14px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--theme-text-muted)' }}>
                Threshold (N)
              </h3>
              <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
                Number of arbitrators required to reach a verdict
              </p>
              <div className="flex items-center gap-4">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={thresholdN}
                  onChange={e => setThresholdN(parseInt(e.target.value) || 1)}
                  className="w-24 px-3 py-2.5 rounded-lg border text-center font-semibold text-sm transition-colors duration-200 focus:outline-none focus:border-[var(--color-accent)]"
                  style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface-secondary)', color: 'var(--theme-text)' }}
                />
                <span className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
                  arbitrators must submit a verdict
                </span>
              </div>
            </div>
          )}

          <div className="rounded-xl border p-5" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}>
            <h3 className="text-[14px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--theme-text-muted)' }}>
              Timing
            </h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
              Configure timing parameters for the arbitration process
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--theme-text)' }}>
                  <div className="flex items-center gap-2">
                    <Clock size={14} style={{ color: 'var(--theme-text-muted)' }} />
                    Cooling Off (days)
                  </div>
                </label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={coolingOffDays}
                  onChange={e => setCoolingOffDays(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm transition-colors duration-200 focus:outline-none focus:border-[var(--color-accent)]"
                  style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface-secondary)', color: 'var(--theme-text)' }}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                  Wait before escalating to council
                </p>
              </div>
              <div>
                <label className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--theme-text)' }}>
                  <div className="flex items-center gap-2">
                    <Clock size={14} style={{ color: 'var(--theme-text-muted)' }} />
                    Verdict Deadline (hours)
                  </div>
                </label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={verdictDeadlineHours}
                  onChange={e => setVerdictDeadlineHours(parseInt(e.target.value) || 48)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm transition-colors duration-200 focus:outline-none focus:border-[var(--color-accent)]"
                  style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface-secondary)', color: 'var(--theme-text)' }}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                  Time window for arbitrators to vote
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-lg text-white font-medium transition-all duration-200 disabled:opacity-50 cursor-pointer"
            style={{ background: 'var(--color-accent)' }}
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <CheckCircle size={18} />
                Save Configuration
              </>
            )}
          </button>
        </>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} sx={{ borderRadius: 2 }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </div>
  )
}

function AdminBootstrapContent() {
  const [dao, setDao] = useState<{ id: string; name: string; codexHash: string; codexVersion: string; codexUrl: string; status: string; nostrEventId: string | null } | null>(null)
  const [members, setMembers] = useState<{ id: string; daoId: string; pubkey: string; role: string; status: string; credentialEventId: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<'dao' | 'credential' | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const pubkey = localStorage.getItem('pubkey')

  useEffect(() => {
    if (!pubkey) {
      setError('No pubkey found. Please log in first.')
      setLoading(false)
      return
    }

    Promise.all([
      apiCall('/api/dao/foundation').then(r => r.json()),
      apiCall('/api/dao/foundation/members').then(r => r.json()),
    ])
      .then(([daoData, membersData]) => {
        setDao(daoData.dao)
        setMembers(membersData.members || [])
        const myMember = (membersData.members || []).find((m: any) => m.pubkey === pubkey)
        if (myMember?.credentialEventId) setDone(true)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load DAO data'))
      .finally(() => setLoading(false))
  }, [])

  async function publishDaoCreation() {
    if (!dao) return
    setPublishing('dao')
    setStepError(null)
    try {
      const res = await apiCall('/api/dao/foundation')
      const { dao: daoData } = await res.json()
      if (daoData.nostrEventId) {
        setDone(true)
        return
      }

      const template = {
        kind: 30022,
        pubkey: pubkey!,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', `${daoData.id}-dao-creation`],
          ['sub_type', 'dao_creation'],
          ['dao_id', daoData.id],
          ['codex_hash', daoData.codexHash],
          ['codex_version', daoData.codexVersion],
          ['proposal', daoData.id],
          ['vote', 'yes'],
          ['voting_model', '1p1v'],
        ],
        content: JSON.stringify({
          sub_type: 'dao_creation',
          dao_id: daoData.id,
          name: daoData.name,
          codex_hash: daoData.codexHash,
          codex_version: daoData.codexVersion,
          codex_url: daoData.codexUrl,
          status: daoData.status,
        }),
      }

      const signed = await (window as any).nostr?.signEvent(template)
      if (!signed) {
        setStepError('NIP-07 signing failed or was cancelled.')
        return
      }

      await apiCall('/api/dao/foundation/nostr-event-id', {
        method: 'POST',
        body: JSON.stringify({ nostrEventId: signed.id }),
      })

      setDao(prev => prev ? { ...prev, nostrEventId: signed.id } : null)
      if (daoData.nostrEventId) setDone(true)
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Failed to publish DAO creation event')
    } finally {
      setPublishing(null)
    }
  }

  async function publishArbitratorCredential() {
    if (!dao) return
    const myMember = members.find(m => m.pubkey === pubkey)
    if (!myMember || myMember.credentialEventId) {
      setDone(true)
      return
    }

    setPublishing('credential')
    setStepError(null)
    try {
      const template = {
        kind: 30021,
        pubkey: pubkey!,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', `${myMember.daoId}-arbitrator-${pubkey}`],
          ['credential_type', 'arbitrator'],
          ['dao_id', myMember.daoId],
          ['role', myMember.role],
          ['issued_by', pubkey!],
        ],
        content: JSON.stringify({
          credential_type: 'arbitrator',
          dao_id: myMember.daoId,
          role: myMember.role,
          issued_by: pubkey,
          pubkey,
        }),
      }

      const signed = await (window as any).nostr?.signEvent(template)
      if (!signed) {
        setStepError('NIP-07 signing failed or was cancelled.')
        return
      }

      await apiCall(`/api/dao/foundation/members/${pubkey}/credential-event-id`, {
        method: 'POST',
        body: JSON.stringify({ nostrEventId: signed.id }),
      })

      setDone(true)
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Failed to publish arbitrator credential')
    } finally {
      setPublishing(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4 animate-pulse" style={{ background: 'rgba(99,179,237,0.12)' }}>
          <CheckCircle size={24} className="animate-spin" style={{ color: 'var(--color-primary-50)' }} />
        </div>
        <p className="text-[14px]" style={{ color: 'var(--theme-text-muted)' }}>
          Loading foundation data…
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border p-6 text-center" style={{ border: '1px solid var(--color-status-error)', background: 'rgba(239,68,68,0.08)' }}>
        <p className="text-[14px] font-medium" style={{ color: 'var(--color-status-error)' }}>
          {error}
        </p>
      </div>
    )
  }

  const daoCreated = !!dao?.nostrEventId
  const credentialPublished = members.find(m => m.pubkey === pubkey)?.credentialEventId

  if (done || (daoCreated && credentialPublished)) {
    return (
      <div className="rounded-xl border p-8 text-center" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}>
        <div className="flex items-center justify-center w-16 h-16 rounded-full mx-auto mb-4" style={{ background: 'rgba(72,187,120,0.12)' }}>
          <CheckCircle size={32} style={{ color: 'var(--color-status-success)' }} />
        </div>
        <h2 className="text-[20px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>
          Arbitration Council Bootstrap Complete
        </h2>
        <p className="text-[14px] leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>
          The Colabonate Foundation DAO is now operational in bootstrap mode with you as the founding arbitrator.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-5 transition-all duration-200" style={{
        border: daoCreated ? '2px solid var(--color-status-success)' : '1px solid var(--theme-border)',
        background: 'var(--theme-surface)',
      }}>
        <div className="flex items-start gap-4">
          <div className={cn(
            'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors duration-200',
          )}
          style={{
            background: daoCreated ? 'var(--color-status-success)' : 'var(--theme-surface-secondary)',
            color: daoCreated ? 'white' : 'var(--theme-text-muted)',
          }}>
            {daoCreated ? <CheckCircle size={16} /> : '1'}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>
              Publish DAO Creation Event
            </h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
              Sign and publish the Foundation DAO creation event (Kind 30022) to the Nostr relay.
            </p>
            {stepError && publishing === null && (
              <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                {stepError}
              </Alert>
            )}
            <button
              onClick={publishDaoCreation}
              disabled={publishing !== null}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-white text-sm font-medium transition-all duration-200 disabled:opacity-50 cursor-pointer"
              style={{ background: 'var(--color-accent)' }}
            >
              {publishing === 'dao' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Publishing…
                </>
              ) : (
                <>
                  <CheckCircle size={16} />
                  {daoCreated ? 'Published' : 'Publish DAO Creation Event'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-5 transition-all duration-200" style={{
        border: credentialPublished ? '2px solid var(--color-status-success)' : '1px solid var(--theme-border)',
        background: 'var(--theme-surface)',
        opacity: !daoCreated ? 0.6 : 1,
      }}>
        <div className="flex items-start gap-4">
          <div className={cn(
            'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors duration-200',
          )}
          style={{
            background: credentialPublished ? 'var(--color-status-success)' : 'var(--theme-surface-secondary)',
            color: credentialPublished ? 'white' : 'var(--theme-text-muted)',
          }}>
            {credentialPublished ? <CheckCircle size={16} /> : '2'}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>
              Publish Arbitrator Credential
            </h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
              Sign your arbitrator credential (Kind 30021) to establish your authority to issue verdicts.
            </p>
            {stepError && publishing === null && (
              <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                {stepError}
              </Alert>
            )}
            <button
              onClick={publishArbitratorCredential}
              disabled={!daoCreated || publishing !== null}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-white text-sm font-medium transition-all duration-200 disabled:opacity-50 cursor-pointer"
              style={{ background: 'var(--color-accent)' }}
            >
              {publishing === 'credential' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Publishing…
                </>
              ) : (
                <>
                  <Shield size={16} />
                  {credentialPublished ? 'Published' : 'Publish Arbitrator Credential'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AdminGovernanceContent() {
  const { id: daoId = 'colabonate-foundation' } = useParams<{ id: string }>()
  const [config, setConfig] = useState<{
    proposalValidationStrategy: string
    votingStrategies: string
    minVotingPeriodSeconds: number
    maxVotingPeriodSeconds: number
  } | null>(null)
  const [overrides, setOverrides] = useState<Array<{
    proposalType: string
    quorumPercent: number
    majorityPercent: number
    votingPeriodSeconds: number
  }>>([])
  const [codexDefaults, setCodexDefaults] = useState<Record<string, { quorumPercent: number; majorityPercent: number; votingPeriodSeconds: number }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await apiCall(`/api/daos/${daoId}/governance-config`)
        if (!res.ok) { setError('Failed to load'); return }
        const data = await res.json()
        setConfig(data.config)
        setOverrides(data.overrides ?? [])
        setCodexDefaults(data.codexDefaults ?? {})
      } catch { setError('Failed to load') }
      finally { setLoading(false) }
    }
    load()
  }, [daoId])

  async function save() {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiCall(`/api/daos/${daoId}/governance-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save')
      }
    } catch { setError('Failed to save') }
    finally { setSaving(false) }
  }

  function updateOverride(index: number, field: string, value: number) {
    const updated = [...overrides]
    updated[index] = { ...updated[index], [field]: value }
    setOverrides(updated)
  }

  if (loading) return <div className="p-8 text-center text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Loading...</div>

  const editableTypes = ['NORMAL_DECISION', 'CODEX_AMENDMENT', 'TREASURY_SPENDING', 'SANCTION']

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg text-[13px]" style={{ background: 'rgba(245,101,101,0.08)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {config && (
        <div className="p-5 rounded-xl space-y-3" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}>
          <h4 className="text-[14px] font-semibold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
            Global Governance Config
          </h4>
          <div className="grid grid-cols-2 gap-3 text-[12px]" style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}>
            <div>
              <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Validation Strategy</span>
              <span style={{ color: 'var(--theme-text)' }}>{config.proposalValidationStrategy}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Voting Strategies</span>
              <span style={{ color: 'var(--theme-text)' }}>{config.votingStrategies}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Min Voting Period</span>
              <span style={{ color: 'var(--theme-text)' }}>{Math.round(config.minVotingPeriodSeconds / 86400)} days</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Max Voting Period</span>
              <span style={{ color: 'var(--theme-text)' }}>{Math.round(config.maxVotingPeriodSeconds / 86400)} days</span>
            </div>
          </div>
        </div>
      )}

      <div className="p-5 rounded-xl space-y-4" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}>
        <h4 className="text-[14px] font-semibold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
          Per-Type Governance Overrides
        </h4>
        <p className="text-[11px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
          Override values must be stricter than Codex defaults (≥ in all dimensions).
        </p>

        <div className="space-y-3">
          {editableTypes.map(type => {
            const defaults = codexDefaults[type]
            if (!defaults) return null
            const existing = overrides.find(o => o.proposalType === type)
            const quorum = existing?.quorumPercent ?? defaults.quorumPercent
            const majority = existing?.majorityPercent ?? defaults.majorityPercent
            const period = existing?.votingPeriodSeconds ?? defaults.votingPeriodSeconds

            return (
              <div
                key={type}
                className="p-3 rounded-lg"
                style={{ background: 'var(--theme-surface-secondary)', border: '1px solid var(--theme-border)' }}
              >
                <span className="block text-[12px] font-semibold mb-2" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  {type.replace(/_/g, ' ')}
                </span>
                <div className="grid grid-cols-3 gap-2 text-[11px]" style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--theme-text-muted)' }}>
                      Quorum % (≥{defaults.quorumPercent})
                    </span>
                    <input
                      type="number"
                      value={quorum}
                      min={defaults.quorumPercent}
                      onChange={e => {
                        const val = parseInt(e.target.value) || defaults.quorumPercent
                        const idx = overrides.findIndex(o => o.proposalType === type)
                        if (idx >= 0) {
                          updateOverride(idx, 'quorumPercent', val)
                        } else {
                          setOverrides(prev => [...prev, { proposalType: type, quorumPercent: val, majorityPercent: defaults.majorityPercent, votingPeriodSeconds: defaults.votingPeriodSeconds }])
                        }
                      }}
                      className="w-full px-2 py-1 rounded text-[12px]"
                      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                    />
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--theme-text-muted)' }}>
                      Majority % (≥{defaults.majorityPercent})
                    </span>
                    <input
                      type="number"
                      value={majority}
                      min={defaults.majorityPercent}
                      onChange={e => {
                        const val = parseInt(e.target.value) || defaults.majorityPercent
                        const idx = overrides.findIndex(o => o.proposalType === type)
                        if (idx >= 0) {
                          updateOverride(idx, 'majorityPercent', val)
                        } else {
                          setOverrides(prev => [...prev, { proposalType: type, quorumPercent: defaults.quorumPercent, majorityPercent: val, votingPeriodSeconds: defaults.votingPeriodSeconds }])
                        }
                      }}
                      className="w-full px-2 py-1 rounded text-[12px]"
                      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                    />
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--theme-text-muted)' }}>
                      Period days (≥{Math.round(defaults.votingPeriodSeconds / 86400)})
                    </span>
                    <input
                      type="number"
                      value={Math.round(period / 86400)}
                      min={Math.round(defaults.votingPeriodSeconds / 86400)}
                      onChange={e => {
                        const val = (parseInt(e.target.value) || Math.round(defaults.votingPeriodSeconds / 86400)) * 86400
                        const idx = overrides.findIndex(o => o.proposalType === type)
                        if (idx >= 0) {
                          updateOverride(idx, 'votingPeriodSeconds', val)
                        } else {
                          setOverrides(prev => [...prev, { proposalType: type, quorumPercent: defaults.quorumPercent, majorityPercent: defaults.majorityPercent, votingPeriodSeconds: val }])
                        }
                      }}
                      className="w-full px-2 py-1 rounded text-[12px]"
                      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-widest transition-all duration-200 hover:opacity-90 active:scale-95"
          style={{
            background: 'var(--color-primary-50)',
            color: 'white',
            fontFamily: 'var(--typography-fontfamily-sans)',
            opacity: saving ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save Governance Config'}
        </button>
      </div>
    </div>
  )
}