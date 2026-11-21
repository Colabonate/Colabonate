import { Link } from 'react-router-dom'
import { cn } from '@ds/utils'
import {
  Vote, Users, ThumbsUp, ThumbsDown, Minus, Clock,
  ChevronRight, Info, ArrowRight, Shield, UserCheck,
} from 'lucide-react'
import type { Proposal, ProposalVote } from './dao-types'
import type { DaoMember } from '../council/council-types'

export type CardSize = 'S' | 'M' | 'L'

export type DaoListEntityType = 'proposal' | 'member'

export interface DaoListItem {
  id: string
  entityType: DaoListEntityType
  title: string
  subtitle: string
  status: string
  detailPath: string
  proposal?: Proposal
  member?: DaoMember
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  PASSED: { bg: 'rgba(72,187,120,0.12)', text: 'var(--color-status-success)' },
  REJECTED: { bg: 'rgba(245,101,101,0.12)', text: 'var(--color-status-error)' },
  ACTIVE: { bg: 'rgba(99,179,237,0.12)', text: 'var(--color-primary-50)' },
  DRAFT: { bg: 'var(--theme-bg-subtle)', text: 'var(--theme-text-muted)' },
  COMMENT_PERIOD: { bg: 'rgba(255,192,57,0.12)', text: 'var(--color-warning-primary)' },
  EXECUTED: { bg: 'rgba(72,187,120,0.12)', text: 'var(--color-status-success)' },
  CANCELLED: { bg: 'var(--theme-bg-subtle)', text: 'var(--theme-text-muted)' },
  ACCEPTED: { bg: 'rgba(72,187,120,0.08)', text: 'var(--color-status-success)' },
  PENDING: { bg: 'rgba(255,192,57,0.12)', text: 'var(--color-warning-primary)' },
  REVOKED: { bg: 'rgba(245,101,101,0.12)', text: 'var(--color-status-error)' },
}

export function statusStyle(status: string) {
  return STATUS_COLORS[status] ?? { bg: 'var(--theme-bg-subtle)', text: 'var(--theme-text-muted)' }
}

const SIZE_CONFIG: Record<CardSize, {
  galleryH: number
  titleFs: number
  statusFs: number
  iconSize: number
  iconBoxSize: number
  rowH: number
  thumbW: number
}> = {
  S: { galleryH: 130, titleFs: 12, statusFs: 9, iconSize: 16, iconBoxSize: 32, rowH: 52, thumbW: 40 },
  M: { galleryH: 170, titleFs: 13, statusFs: 10, iconSize: 18, iconBoxSize: 38, rowH: 62, thumbW: 48 },
  L: { galleryH: 220, titleFs: 14, statusFs: 10, iconSize: 22, iconBoxSize: 44, rowH: 74, thumbW: 56 },
}

function getVoteStats(votes: ProposalVote[]) {
  const vpFor = votes.filter(v => v.choice === 'FOR').reduce((s, v) => s + v.votingPower, 0)
  const vpAgainst = votes.filter(v => v.choice === 'AGAINST').reduce((s, v) => s + v.votingPower, 0)
  const vpAbstain = votes.filter(v => v.choice === 'ABSTAIN').reduce((s, v) => s + v.votingPower, 0)
  const total = vpFor + vpAgainst + vpAbstain
  return { vpFor, vpAgainst, vpAbstain, total, count: votes.length }
}

function VoteBar({ votes }: { votes: ProposalVote[] }) {
  const { vpFor, vpAgainst, vpAbstain, total } = getVoteStats(votes)
  if (total === 0) return null
  return (
    <div
      className="flex h-2 rounded-full overflow-hidden"
      style={{ background: 'var(--theme-surface-secondary)' }}
    >
      {vpFor > 0 && (
        <div style={{ width: `${(vpFor / total) * 100}%`, background: 'var(--color-status-success)' }} />
      )}
      {vpAgainst > 0 && (
        <div style={{ width: `${(vpAgainst / total) * 100}%`, background: 'var(--color-status-error)' }} />
      )}
      {vpAbstain > 0 && (
        <div style={{ width: `${(vpAbstain / total) * 100}%`, background: 'var(--color-neutral-8)' }} />
      )}
    </div>
  )
}

function EntityIcon({ type, size }: { type: DaoListEntityType; size: number }) {
  if (type === 'proposal') return <Vote size={size} />
  return <Users size={size} />
}

function StatusBadge({ status }: { status: string }) {
  const sc = statusStyle(status)
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest leading-none"
      style={{
        background: sc.bg,
        color: sc.text,
        fontFamily: 'var(--typography-fontfamily-sans)',
      }}
    >
      {status}
    </span>
  )
}

export function DaoGalleryCard({ item, size, selected, onSelect }: { item: DaoListItem; size: CardSize; selected?: boolean; onSelect?: () => void }) {
  const cfg = SIZE_CONFIG[size]
  const iconBg = item.entityType === 'proposal' ? 'rgba(99,179,237,0.12)' : 'rgba(157,123,237,0.12)'
  const iconColor = item.entityType === 'proposal' ? 'var(--color-primary-50)' : 'var(--color-secondary-50)'

  const Wrapper = onSelect ? 'div' : Link
  const wrapperProps = onSelect
    ? { onClick: onSelect }
    : { to: item.detailPath }

  return (
    <Wrapper
      {...wrapperProps as any}
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl no-underline',
        'transition-all duration-200 cursor-pointer',
        'hover:-translate-y-px hover:shadow-lg',
      )}
      style={{
        height: cfg.galleryH,
        background: 'var(--theme-surface)',
        border: selected
          ? '2px solid var(--color-primary-50)'
          : '1px solid var(--theme-border)',
        boxShadow: selected
          ? '0 0 0 1px var(--color-primary-50), 0 4px 16px rgba(99,179,237,0.18)'
          : undefined,
      }}
    >
      <div className="flex items-center gap-2 p-3 pb-1">
        <div
          className="flex items-center justify-center rounded-lg shrink-0"
          style={{ width: cfg.iconBoxSize, height: cfg.iconBoxSize, background: iconBg, color: iconColor }}
        >
          <EntityIcon type={item.entityType} size={cfg.iconSize} />
        </div>
        <div className="flex-1 min-w-0">
          <StatusBadge status={item.status} />
        </div>
      </div>

      <div className="flex flex-col flex-1 px-3 pt-1 pb-3 min-w-0">
        <span
          className="font-semibold leading-tight truncate"
          style={{ fontSize: cfg.titleFs, color: 'var(--theme-text)' }}
        >
          {item.title}
        </span>
        <span
          className="text-[11px] leading-snug truncate mt-0.5"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          {item.subtitle}
        </span>

        {item.entityType === 'proposal' && item.proposal && (
          <div className="mt-auto pt-2">
            <VoteBar votes={item.proposal.votes} />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
                {item.proposal.votes.length} vote{item.proposal.votes.length !== 1 ? 's' : ''}
              </span>
              {item.proposal.status === 'ACTIVE' && (
                <Clock size={10} style={{ color: 'var(--color-primary-50)' }} />
              )}
            </div>
          </div>
        )}

        {item.entityType === 'member' && item.member && (
          <div className="mt-auto pt-2 flex items-center gap-1">
            <Shield size={10} style={{ color: 'var(--theme-text-muted)' }} />
            <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
              {item.member.role}
            </span>
          </div>
        )}
      </div>
    </Wrapper>
  )
}

export function DaoListRow({ item, size, selected, onSelect }: { item: DaoListItem; size: CardSize; selected?: boolean; onSelect?: () => void }) {
  const cfg = SIZE_CONFIG[size]
  const iconBg = item.entityType === 'proposal' ? 'rgba(99,179,237,0.12)' : 'rgba(157,123,237,0.12)'
  const iconColor = item.entityType === 'proposal' ? 'var(--color-primary-50)' : 'var(--color-secondary-50)'

  const Wrapper = onSelect ? 'div' : Link
  const wrapperProps = onSelect
    ? { onClick: onSelect }
    : { to: item.detailPath }

  return (
    <Wrapper
      {...wrapperProps as any}
      className={cn(
        'group flex items-center gap-3 px-3 rounded-xl no-underline',
        'transition-all duration-150 cursor-pointer',
        'hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]',
      )}
      style={{
        height: cfg.rowH,
        background: selected
          ? 'rgba(99,179,237,0.06)'
          : 'var(--theme-surface)',
        border: selected
          ? '2px solid var(--color-primary-50)'
          : '1px solid var(--theme-border)',
        boxShadow: selected
          ? '0 0 0 1px var(--color-primary-50), 0 4px 16px rgba(99,179,237,0.18)'
          : undefined,
      }}
    >
      <div
        className="flex items-center justify-center rounded-lg shrink-0"
        style={{ width: cfg.thumbW, height: cfg.thumbW, background: iconBg, color: iconColor }}
      >
        <EntityIcon type={item.entityType} size={cfg.iconSize} />
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="font-semibold truncate"
            style={{ fontSize: cfg.titleFs, color: 'var(--theme-text)' }}
          >
            {item.title}
          </span>
          <StatusBadge status={item.status} />
        </div>
        <span
          className="text-[11px] truncate"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          {item.subtitle}
        </span>
      </div>

      {item.entityType === 'proposal' && item.proposal && (
        <div className="flex items-center gap-3 shrink-0">
          <VoteBar votes={item.proposal.votes} />
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--theme-text-muted)' }}>
            {item.proposal.votes.length}
          </span>
        </div>
      )}

      <ChevronRight size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
    </Wrapper>
  )
}

export function DaoSizeToggle({ size, onChange }: { size: CardSize; onChange: (s: CardSize) => void }) {
  const sizes: CardSize[] = ['S', 'M', 'L']
  return (
    <div
      className="flex items-center gap-0.5 p-0.5 rounded-lg"
      style={{ background: 'var(--theme-bg-subtle)' }}
    >
      {sizes.map(s => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className="flex items-center justify-center rounded-md cursor-pointer transition-all duration-150"
          style={{
            width: 30, height: 30,
            background: size === s ? 'var(--theme-surface)' : 'transparent',
            color: size === s ? 'var(--color-primary-50)' : 'var(--theme-text-muted)',
            border: size === s ? '1px solid var(--theme-border)' : '1px solid transparent',
            fontSize: 11, fontWeight: 600,
          }}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

export function DaoEmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center py-16 gap-3">
      <div
        className="flex items-center justify-center w-16 h-16 rounded-2xl"
        style={{ background: 'var(--theme-bg-subtle)' }}
      >
        <Vote size={28} style={{ color: 'var(--theme-text-muted)' }} />
      </div>
      <span className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>
        {message}
      </span>
      {sub && (
        <span
          className="text-[13px] text-center max-w-[300px]"
          style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {sub}
        </span>
      )}
    </div>
  )
}

export function DaoDemoProposal({ daoId }: { daoId: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl" style={{
      background: 'rgba(157,123,237,0.06)',
      border: '1px solid rgba(157,123,237,0.20)',
    }}>
      <div
        className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
        style={{ background: 'rgba(157,123,237,0.15)', color: 'var(--color-secondary-50)' }}
      >
        <Info size={20} />
      </div>
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        <h4 className="text-[14px] font-semibold" style={{ color: 'var(--theme-text)' }}>
          What are Proposals?
        </h4>
        <p
          className="text-[12px] leading-relaxed"
          style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          DAO proposals let members vote on protocol changes, treasury spending, and governance decisions.
          Any L1+ user can create a proposal for community discussion and voting.
        </p>
        <div className="flex items-center gap-3 mt-1">
          <Link
            to="/help/dao-governance"
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg no-underline',
              'text-[11px] font-semibold transition-all duration-150',
              'hover:opacity-80',
            )}
            style={{
              background: 'rgba(157,123,237,0.12)',
              color: 'var(--color-secondary-50)',
            }}
          >
            Learn more
            <ArrowRight size={12} />
          </Link>
          <Link
            to={`/dao/${daoId}/proposals/new`}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg no-underline',
              'text-[11px] font-bold uppercase tracking-widest transition-all duration-200',
              'hover:opacity-90 active:scale-95',
            )}
            style={{
              background: 'var(--color-primary-50)',
              color: 'white',
            }}
          >
            Create Proposal
          </Link>
        </div>
      </div>
    </div>
  )
}

export function DaoDetailPanel({
  item,
  daoId: _daoId,
  formatTime,
}: {
  item: DaoListItem | null
  daoId: string
  formatTime?: (date: string) => string
}) {
  if (!item) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 gap-3 rounded-xl"
        style={{
          border: '1px solid var(--theme-border)',
          background: 'var(--theme-surface)',
          minHeight: 300,
        }}
      >
        <Vote size={28} style={{ color: 'var(--theme-text-muted)', opacity: 0.3 }} />
        <span className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
          Select an item to view details
        </span>
      </div>
    )
  }

  if (item.entityType === 'proposal' && item.proposal) {
    const p = item.proposal
    const { vpFor, vpAgainst, vpAbstain, total, count } = getVoteStats(p.votes)
    const votingEnd = p.votingEnd ? new Date(p.votingEnd).getTime() : 0
    const isVotingActive = p.status === 'ACTIVE' && votingEnd > Date.now()

    return (
      <div
        className="flex flex-col gap-4 p-4 rounded-xl overflow-y-auto"
        style={{
          border: '1px solid var(--theme-border)',
          background: 'var(--theme-surface)',
          maxHeight: 'calc(100vh - 180px)',
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={p.status} />
          <Link
            to={item.detailPath}
            className={cn(
              'inline-flex items-center gap-1 no-underline',
              'text-[11px] font-semibold transition-all duration-150',
              'hover:opacity-80',
            )}
            style={{ color: 'var(--color-primary-50)' }}
          >
            Full details
            <ChevronRight size={12} />
          </Link>
        </div>

        <div>
          <h3 className="text-[15px] font-semibold leading-tight" style={{ color: 'var(--theme-text)' }}>
            {p.title}
          </h3>
          <span className="text-[11px] mt-1 block" style={{ color: 'var(--theme-text-muted)' }}>
            by {p.authorPubkey.slice(0, 12)}...
          </span>
        </div>

        {p.content && (
          <p
            className="text-[12px] leading-relaxed line-clamp-4"
            style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {p.content}
          </p>
        )}

        {total > 0 && (
          <div>
            <VoteBar votes={p.votes} />
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[11px] font-semibold" style={{ color: 'var(--color-status-success)' }}>
                <ThumbsUp size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                {vpFor}
              </span>
              <span className="text-[11px] font-semibold" style={{ color: 'var(--color-status-error)' }}>
                <ThumbsDown size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                {vpAgainst}
              </span>
              <span className="text-[11px] font-semibold" style={{ color: 'var(--theme-text-muted)' }}>
                <Minus size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                {vpAbstain}
              </span>
              <span className="text-[10px] ml-auto" style={{ color: 'var(--theme-text-muted)' }}>
                {count} vote{count !== 1 ? 's' : ''} &middot; {total} VP
              </span>
            </div>
          </div>
        )}

        {isVotingActive && formatTime && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(99,179,237,0.08)' }}>
            <Clock size={12} style={{ color: 'var(--color-primary-50)' }} />
            <span className="text-[11px]" style={{ color: 'var(--color-primary-50)' }}>
              Ends {formatTime(p.votingEnd ?? '')}
            </span>
          </div>
        )}

        <Link
          to={item.detailPath}
          className={cn(
            'flex items-center justify-center gap-2 py-2.5 rounded-xl no-underline',
            'text-[12px] font-bold uppercase tracking-widest transition-all duration-200',
            'hover:opacity-90 active:scale-95',
          )}
          style={{
            background: 'var(--color-primary-50)',
            color: 'white',
          }}
        >
          View Full Details
          <ArrowRight size={14} />
        </Link>
      </div>
    )
  }

  if (item.entityType === 'member' && item.member) {
    const m = item.member
    return (
      <div
        className="flex flex-col gap-4 p-4 rounded-xl overflow-y-auto"
        style={{
          border: '1px solid var(--theme-border)',
          background: 'var(--theme-surface)',
          maxHeight: 'calc(100vh - 180px)',
        }}
      >
        <div className="flex items-center justify-center">
          <div
            className="flex items-center justify-center w-16 h-16 rounded-2xl"
            style={{ background: 'rgba(157,123,237,0.12)', color: 'var(--color-secondary-50)' }}
          >
            <Users size={28} />
          </div>
        </div>

        <div className="text-center">
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--theme-text)' }}>
            {m.pubkey.slice(0, 16)}...
          </h3>
          <div className="flex items-center justify-center gap-2 mt-2">
            <StatusBadge status={m.status} />
            <span className="text-[11px] font-medium" style={{ color: 'var(--theme-text-muted)' }}>
              {m.role}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 p-3 rounded-lg" style={{ background: 'var(--theme-bg-subtle)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>Role</span>
            <span className="text-[11px] font-medium" style={{ color: 'var(--theme-text)' }}>{m.role}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>Status</span>
            <span className="text-[11px] font-medium" style={{ color: 'var(--theme-text)' }}>{m.status}</span>
          </div>
          {m.acceptedAt && (
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>Accepted</span>
              <span className="text-[11px] font-medium" style={{ color: 'var(--theme-text)' }}>
                {new Date(m.acceptedAt).toLocaleDateString()}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>Added</span>
            <span className="text-[11px] font-medium" style={{ color: 'var(--theme-text)' }}>
              {new Date(m.addedAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mt-1" style={{ color: 'var(--color-secondary-50)' }}>
          <UserCheck size={14} />
          <span className="text-[11px] font-medium">DAO Member</span>
        </div>
      </div>
    )
  }

  return null
}

export function proposalToListItem(p: Proposal, daoId: string): DaoListItem {
  return {
    id: p.id,
    entityType: 'proposal',
    title: p.title,
    subtitle: `by ${p.authorPubkey.slice(0, 12)}...`,
    status: p.status,
    detailPath: `/dao/${daoId}/proposals/${p.id}`,
    proposal: p,
  }
}

export function memberToListItem(m: DaoMember): DaoListItem {
  return {
    id: m.id,
    entityType: 'member',
    title: `${m.pubkey.slice(0, 16)}...`,
    subtitle: m.role,
    status: m.status,
    detailPath: '#',
    member: m,
  }
}
