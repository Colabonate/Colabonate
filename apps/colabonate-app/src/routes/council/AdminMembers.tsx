import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import { PageContainer, Modal, ModalContent, ModalActions } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { adminApiCall } from '../../lib/nostr-admin-auth'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { cn } from '@ds/utils'
import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import { UserPlus, Users, UserMinus, Shield, MessageSquare } from 'lucide-react'
import type { DaoMember } from './council-types'

export function AdminMembers() {
  const navigate = useNavigate()
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

  const containerRef = usePageAnimation([
    { selector: '.dashboard-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

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

  const renderTable = () => (
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
                    <div
                      className="flex items-center justify-center w-12 h-12 rounded-xl mb-3"
                      style={{ background: 'rgba(99,179,237,0.12)' }}
                    >
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
  )

  return (
    <PageContainer size="wide" spacing="lg" ref={containerRef}>
      <PageHeader
        icon={<Users size={20} />}
        title="Council Members"
        subtitle={`Manage ${members.length} arbitrator and mediator role${members.length !== 1 ? 's' : ''}`}
        onBack={() => navigate('/council')}
        backLabel="Back to Council"
        actions={
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-all duration-200 hover:opacity-90 cursor-pointer"
            style={{ background: 'var(--color-accent)' }}
          >
            <UserPlus size={16} />
            Invite Member
          </button>
        }
      />

      <div className="dashboard-animate rounded-xl border overflow-hidden" style={{
        border: '1px solid var(--theme-border)',
        background: 'var(--theme-surface)',
      }}>
        {error ? (
          <div
            className="p-6 text-center"
            style={{ color: 'var(--color-status-error)' }}
          >
            {error}
          </div>
        ) : (
          renderTable()
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
                    className={cn(
                      'flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all duration-200',
                    )}
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
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          sx={{ borderRadius: 2 }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </PageContainer>
  )
}
