import type { EntityPayload, OfferItem, CooperationItem, CompanyItem, TicketItem, ProposalItem, DaoItem, DaoMemberItem, TreasuryItem, BountyItem, BountyApplicationItem } from './ai-assistant.types';
import { Link } from 'react-router-dom';
import { Button } from '@mui/material';
import { useTranslation } from '../../contexts/LocaleContext';
import {
  ArrowForward as ArrowForwardIcon,
  AccountBalance as AccountBalanceIcon,
  Group as GroupIcon,
  Toll as TollIcon,
} from '@mui/icons-material';
import { DomainFilterLink } from './DomainFilterLink'
import { OfferResults, CooperationResults } from './ResultCards';

interface EntityResultBlockProps {
  payload: EntityPayload;
  compact?: boolean;
}

// F11: proposal links used to be hardcoded to the Foundation DAO. Prefer the
// proposal's own daoId; if it is absent, fall back to the DAO list rather than
// linking to the wrong DAO.
function proposalHref(proposal: ProposalItem): string {
  return proposal.daoId ? `/dao/${proposal.daoId}/proposals/${proposal.id}` : '/dao';
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'ACTIVE' || status === 'ACCEPTED' || status === 'PAID'
    ? 'var(--color-status-success)'
    : status === 'PENDING' || status === 'OPEN'
      ? 'var(--color-primary-50)'
      : 'var(--theme-text-muted)';

  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
      style={{ background: `${color}18`, color }}
    >
      {status}
    </span>
  );
}

export function EntityResultBlock({ payload, compact = true }: EntityResultBlockProps) {
  const { formatNumber } = useTranslation();

  switch (payload.kind) {
    case 'offers':
      return <OfferResults items={(payload.items ?? []) as OfferItem[]} />;

    case 'cooperations':
      return <CooperationResults items={(payload.items ?? []) as CooperationItem[]} />;

    case 'companies': {
      const items = (payload.items ?? []) as CompanyItem[];

      if (compact) {
        return (
          <div>
            <div className="flex flex-col gap-2">
              {items.map((company, i) => (
                <div key={i} className="p-2 rounded-lg border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
                  <p className="text-[12px] font-medium" style={{ color: 'var(--theme-text)' }}>{company.name}</p>
                  {company.city && (
                    <p className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>{company.city}</p>
                  )}
                </div>
              ))}
            </div>
            <DomainFilterLink domain="buy" label="View vendors" />
          </div>
        );
      }

      return (
        <div>
          <div className="flex flex-col gap-2">
            {items.map((company, i) => (
              <div key={i} className="min-w-0 p-3 rounded-xl border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
                <p className="text-[13px] font-semibold mb-0.5 [overflow-wrap:anywhere]" style={{ color: 'var(--theme-text)' }}>{company.name}</p>
                {(company.city || company.country) && (
                  <p className="text-[11px] mb-1" style={{ color: 'var(--theme-text-muted)' }}>
                    {[company.city, company.country].filter(Boolean).join(', ')}
                  </p>
                )}
                {company.description && (
                  <p className="text-[11px] line-clamp-2 mb-1.5" style={{ color: 'var(--theme-text-muted)' }}>
                    {company.description}
                  </p>
                )}
                  <Button
                    component={Link}
                    to={`/c/${company.id}`}
                    className="flex items-center gap-1 text-[11px] font-medium"
                    sx={{ textTransform: 'none', color: 'var(--color-primary-50)', minWidth: 0, padding: 0, '&:hover': { opacity: 0.85 } }}
                  >
                    View vendor <ArrowForwardIcon sx={{ fontSize: 11 }} />
                  </Button>
              </div>
            ))}
          </div>
          <DomainFilterLink domain="buy" label="View all vendors" />
        </div>
      );
    }

    case 'tickets': {
      const items = (payload.items ?? []) as TicketItem[];

      if (compact) {
        return (
          <div>
            <div className="flex flex-col gap-2">
              {items.map((ticket, i) => (
                <div key={i} className="p-2 rounded-lg border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}>
                      {ticket.status}
                    </span>
                    <span className="text-[11px] font-bold" style={{ color: 'var(--color-primary-50)' }}>
                      {formatNumber(ticket.amountSats ?? 0)} sats
                    </span>
                  </div>
                  {ticket.offer && (
                    <Button
                      component={Link}
                      to={`/offers/${ticket.offer.id}`}
                      className="text-[11px] mt-1 block truncate"
                      sx={{ textTransform: 'none', color: 'var(--color-primary-40)', minWidth: 0, padding: 0, '&:hover': { opacity: 0.85 } }}
                    >
                      {ticket.offer.title}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <DomainFilterLink domain="buy" label="View orders" />
              <DomainFilterLink domain="sell" label="View received" />
            </div>
          </div>
        );
      }

      return (
        <div>
          <div className="flex flex-col gap-2">
            {items.map((ticket, i) => (
              <div key={i} className="min-w-0 p-3 rounded-xl border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
                <div className="flex items-center justify-between mb-1">
                  {ticket.status && <StatusBadge status={ticket.status} />}
                  <span className="text-[13px] font-bold" style={{ color: 'var(--color-primary-50)' }}>
                    {formatNumber(ticket.amountSats ?? 0)} sats
                  </span>
                </div>
                {ticket.offer && (
                    <Button
                      component={Link}
                      to={`/offers/${ticket.offer.id}`}
                      className="text-[12px] font-medium truncate block mb-1"
                      sx={{ textTransform: 'none', color: 'var(--theme-text)', minWidth: 0, padding: 0, '&:hover': { opacity: 0.85 } }}
                    >
                      {ticket.offer.title}
                    </Button>
                )}
                  <Button
                    component={Link}
                    to={`/tickets/${ticket.id}`}
                    className="flex items-center gap-1 text-[11px] font-medium"
                    sx={{ textTransform: 'none', color: 'var(--color-primary-50)', minWidth: 0, padding: 0, '&:hover': { opacity: 0.85 } }}
                  >
                    View ticket <ArrowForwardIcon sx={{ fontSize: 11 }} />
                  </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <DomainFilterLink domain="buy" label="View all orders" />
            <DomainFilterLink domain="sell" label="View received orders" />
          </div>
        </div>
      );
    }

    case 'proposals': {
      const items = (payload.items ?? []) as ProposalItem[];

      if (compact) {
        return (
          <div>
            <div className="flex flex-col gap-2">
              {items.map((proposal, i) => (
                <div key={i} className="p-2 rounded-lg border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-[12px] font-medium [overflow-wrap:anywhere]" style={{ color: 'var(--theme-text)' }}>{proposal.title}</p>
                    {proposal.status && <StatusBadge status={proposal.status} />}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px]" style={{ color: 'var(--color-status-success)' }}>
                      For: {proposal.votesFor ?? 0}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--color-status-error)' }}>
                      Against: {proposal.votesAgainst ?? 0}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
                      Abstain: {proposal.votesAbstain ?? 0}
                    </span>
                  </div>
                  <Button
                    component={Link}
                    to={proposalHref(proposal)}
                    className="text-[10px] mt-1 block"
                    sx={{ textTransform: 'none', color: 'var(--color-primary-40)', minWidth: 0, padding: 0, '&:hover': { opacity: 0.85 } }}
                  >
                    View proposal →
                  </Button>
                </div>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {items.map((proposal, i) => (
              <div key={i} className="min-w-0 p-3 rounded-xl border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="min-w-0 text-[13px] font-semibold [overflow-wrap:anywhere]" style={{ color: 'var(--theme-text)' }}>{proposal.title}</p>
                  {proposal.status && <StatusBadge status={proposal.status} />}
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px]" style={{ color: 'var(--color-status-success)' }}>
                    For: {proposal.votesFor ?? 0}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--color-status-error)' }}>
                    Against: {proposal.votesAgainst ?? 0}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                    Abstain: {proposal.votesAbstain ?? 0}
                  </span>
                </div>
                {proposal.votingEnd && (
                  <p className="text-[10px] mb-1" style={{ color: 'var(--theme-text-muted)' }}>
                    Voting ends: {proposal.votingEnd}
                  </p>
                )}
                <Button
                  component={Link}
                  to={proposalHref(proposal)}
                  className="flex items-center gap-1 text-[11px] font-medium"
                  sx={{ textTransform: 'none', color: 'var(--color-primary-50)', minWidth: 0, padding: 0, '&:hover': { opacity: 0.85 } }}
                >
                  View proposal <ArrowForwardIcon sx={{ fontSize: 11 }} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'daos': {
      const items = (payload.items ?? []) as DaoItem[];

      return (
        <div>
          <div className="flex flex-col gap-2">
            {items.map((dao, i) => (
              <div key={i} className="min-w-0 p-3 rounded-xl border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-primary-8)' }}>
                    <AccountBalanceIcon sx={{ fontSize: 18, color: 'var(--color-primary-50)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="min-w-0 text-[13px] font-semibold [overflow-wrap:anywhere]" style={{ color: 'var(--theme-text)' }}>{dao.name}</p>
                    {dao.status && <StatusBadge status={dao.status} />}
                    <div className="flex items-center gap-3 mt-1">
                      {dao.memberCount != null && (
                        <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                          {dao.memberCount} members
                        </span>
                      )}
                      {dao.proposalCount != null && (
                        <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                          {dao.proposalCount} proposals
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  component={Link}
                  to={`/dao/${dao.id}`}
                  className="mt-2 flex items-center gap-1 text-[11px] font-medium"
                  sx={{ textTransform: 'none', color: 'var(--color-primary-50)', minWidth: 0, padding: 0, '&:hover': { opacity: 0.85 } }}
                >
                  View DAO <ArrowForwardIcon sx={{ fontSize: 11 }} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'dao_members': {
      const items = (payload.items ?? []) as DaoMemberItem[];

      return (
        <div>
          <div className="flex flex-col gap-2">
            {items.map((member, i) => (
              <div key={i} className="p-2 rounded-lg border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GroupIcon sx={{ fontSize: 14, color: 'var(--theme-text-muted)' }} />
                    <p className="text-[12px] font-medium" style={{ color: 'var(--theme-text)' }}>
                      {member.pubkey.slice(0, 12)}…{member.pubkey.slice(-4)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {member.role && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--color-primary-8)', color: 'var(--color-primary-40)' }}>
                        {member.role}
                      </span>
                    )}
                    {member.status && <StatusBadge status={member.status} />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'dao_treasury': {
      const items = (payload.items ?? []) as TreasuryItem[];
      const treasury = items[0];

      if (!treasury) return null;

      return (
        <div className="p-3 rounded-xl border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-primary-8)' }}>
              <TollIcon sx={{ fontSize: 18, color: 'var(--color-primary-50)' }} />
            </div>
            <div>
              <p className="min-w-0 text-[13px] font-semibold [overflow-wrap:anywhere]" style={{ color: 'var(--theme-text)' }}>DAO Treasury</p>
              <p className="text-[14px] font-bold" style={{ color: 'var(--color-primary-50)' }}>
                {formatNumber(treasury.balanceSats ?? 0)} sats
              </p>
              {treasury.transactionCount != null && (
                <p className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                  {treasury.transactionCount} transactions
                </p>
              )}
            </div>
          </div>
        </div>
      );
    }

    case 'deleted':
      return (
        <p className="text-[12px]" style={{ color: 'var(--color-status-error)' }}>
          {payload.title ?? 'Item'} was deleted
        </p>
      );

    case 'bounties': {
      const items = (payload.items ?? []) as BountyItem[];

      return (
        <div className="flex flex-col gap-2">
          {items.map((bounty, i) => (
            <div key={bounty.id ?? i} className="min-w-0 p-3 rounded-xl border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[13px] font-semibold [overflow-wrap:anywhere]" style={{ color: 'var(--theme-text)' }}>{bounty.title}</p>
                {bounty.status && <StatusBadge status={bounty.status} />}
              </div>
              {bounty.budgetSats != null && (
                <p className="text-[13px] font-bold mt-1" style={{ color: 'var(--color-primary-50)' }}>
                  {formatNumber(bounty.budgetSats)} sats
                </p>
              )}
              {bounty.requiredCapabilities && bounty.requiredCapabilities.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {bounty.requiredCapabilities.map(cap => (
                    <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}>
                      {cap}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    case 'bounty_applications': {
      const items = (payload.items ?? []) as BountyApplicationItem[];

      return (
        <div className="flex flex-col gap-2">
          {items.map((application, i) => (
            <div key={application.id ?? i} className="flex items-center justify-between gap-2 p-2 rounded-lg border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
              <span className="min-w-0 text-[12px] truncate" style={{ color: 'var(--theme-text)' }}>
                {application.agentProfile?.name ?? application.offer?.title ?? 'Application'}
              </span>
              {application.status && <StatusBadge status={application.status} />}
            </div>
          ))}
        </div>
      );
    }

    case 'payment_status': {
      const payment = payload.entity;
      return (
        <div className="flex items-center gap-2 p-2 rounded-lg border" style={{ background: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
          {payment.status && <StatusBadge status={payment.paid ? 'PAID' : payment.status} />}
          {payment.rail && (
            <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>{payment.rail}</span>
          )}
        </div>
      );
    }

    // Images are handled by the create/update flow (they appear on the created
    // entity's card), so these payloads need no separate card.
    case 'pending_images':
    case 'image_uploaded':
      return null;

    default:
      // F11: never render an "Unknown result type" placeholder — an unrecognised
      // tool payload is silently omitted and the assistant's prose carries it.
      return null;
  }
}
