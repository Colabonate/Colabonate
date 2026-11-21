import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@ds/utils';
import { SatsAmount } from '../currency/SatsAmount';
import { richTextToPlainText } from '../offers';
import { RemotePriceLabel, usesNonSatsPriceLabel } from '../offers/RemotePriceLabel';
import { TYPE_COLORS } from '../../routes/coop/coop-constants';
import { DomainFilterLink } from './DomainFilterLink';
import type { OfferItem, CooperationItem } from './ai-assistant.types';

// Foreign-price fields the search API returns for REMOTE listings (ADR-277 D9).
// Declared here, not in ai-assistant.types.ts, so the widening stays local.
type OfferResultItem = OfferItem & {
  source?: 'LOCAL' | 'REMOTE';
  priceAmount?: string | null;
  priceCurrency?: string | null;
};

// Cards collapse to a thumbnail row inside narrow containers (FAB panel,
// phones) and switch to image tiles once the result block is ≥ 24rem wide.
// Container queries, not viewport breakpoints: the same component renders in
// the 400px FAB panel and the 880px /ai page.

const INITIAL_VISIBLE = 6;

const OFFER_TYPE_LABELS: Record<string, string> = {
  SERVICE: 'Service',
  PRODUCT: 'Product',
  AGENT_SETUP: 'Agent',
  COOP: 'Coop',
};

function isRenderableImage(src: unknown): src is string {
  return typeof src === 'string' && /^(https?:\/\/|data:image\/|\/)/.test(src);
}

function pickThumb(item: { imageThumbs?: unknown; images?: unknown }): string | undefined {
  for (const list of [item.imageThumbs, item.images]) {
    if (Array.isArray(list)) {
      const hit = list.find(isRenderableImage);
      if (hit) return hit;
    }
  }
  return undefined;
}

function initialOf(title: string): string {
  return title.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?';
}

function ResultThumb({ src, title }: { src?: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg w-[72px] h-[72px] @sm:w-full @sm:h-auto @sm:aspect-[16/10]"
      style={{ background: 'var(--theme-bg-subtle)' }}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden className="text-[22px] font-bold leading-none" style={{ color: 'var(--theme-text-muted)' }}>
          {initialOf(title)}
        </span>
      )}
    </div>
  );
}

function Tag({ children, color, bg }: { children: ReactNode; color?: string; bg?: string }) {
  return (
    <span
      className="inline-block max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: bg ?? 'var(--theme-bg-subtle)', color: color ?? 'var(--theme-text-muted)' }}
    >
      {children}
    </span>
  );
}

interface ResultCardProps {
  to: string;
  title: string;
  thumb?: string;
  status?: string;
  children?: ReactNode;
}

function ResultCard({ to, title, thumb, status, children }: ResultCardProps) {
  // ACTIVE is the default state of anything discoverable — only flag the rest.
  const showStatus = status && status !== 'ACTIVE' && status !== 'OPEN';

  return (
    <Link
      to={to}
      className={cn(
        'group flex h-full min-w-0 flex-row gap-3 rounded-xl border p-2.5 no-underline transition-colors @sm:flex-col @sm:gap-2.5',
        'border-[var(--theme-border)] bg-[var(--theme-surface)] hover:border-[var(--color-primary-50)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-50)]',
      )}
    >
      <ResultThumb src={thumb} title={title} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 @sm:px-0.5 @sm:pb-0.5">
        <p
          className="line-clamp-2 text-[14px] font-semibold leading-snug [overflow-wrap:anywhere] group-hover:text-[var(--color-primary-50)]"
          style={{ color: 'var(--theme-text)' }}
          title={title}
        >
          {title}
        </p>
        {children}
        {showStatus && (
          <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--theme-text-muted)' }}>
            {status}
          </span>
        )}
      </div>
    </Link>
  );
}

interface ResultGridProps<T> {
  items: T[];
  noun: [singular: string, plural: string];
  renderItem: (item: T) => ReactNode;
  footer?: ReactNode;
}

function ResultGrid<T extends { id: string }>({ items, noun, renderItem, footer }: ResultGridProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, INITIAL_VISIBLE);
  const hidden = items.length - visible.length;

  if (items.length === 0) {
    return (
      <p className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
        No {noun[1]} found.
      </p>
    );
  }

  return (
    <section className="@container w-full" aria-label={`${items.length} ${items.length === 1 ? noun[0] : noun[1]}`}>
      <p className="mb-2 text-[12px] font-medium" style={{ color: 'var(--theme-text-muted)' }}>
        {items.length} {items.length === 1 ? noun[0] : noun[1]}
      </p>
      <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @2xl:grid-cols-3">
        {visible.map(item => (
          <div key={item.id} className="min-w-0 h-full">{renderItem(item)}</div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-2 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-opacity hover:opacity-80"
            style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}
          >
            Show {hidden} more
          </button>
        )}
        {footer}
      </div>
    </section>
  );
}

export function OfferResults({ items }: { items: OfferResultItem[] }) {
  const query = items[0]?.sourceQuery;
  const single = items.length === 1;

  return (
    <ResultGrid
      items={items}
      noun={['offer', 'offers']}
      footer={<DomainFilterLink domain="buy" query={query} offerType={single ? undefined : items[0]?.offerType} />}
      renderItem={offer => (
        <ResultCard to={`/offers/${offer.id}`} title={offer.title} thumb={pickThumb(offer)} status={offer.status}>
          {usesNonSatsPriceLabel(offer) ? (
            <span className="text-[13px] font-medium" style={{ color: 'var(--theme-text)' }}>
              <RemotePriceLabel offer={offer} rates={{}} formatNumber={n => String(n)} showEstimate={false} />
            </span>
          ) : (
            <SatsAmount sats={offer.priceSats ?? 0} size="sm" />
          )}
          {(offer.offerType || offer.category) && (
            <div className="flex min-w-0 flex-wrap gap-1">
              {offer.offerType && (
                <Tag color="var(--color-primary-50)" bg="var(--color-primary-8)">
                  {OFFER_TYPE_LABELS[offer.offerType] ?? offer.offerType}
                </Tag>
              )}
              {offer.category && <Tag>{offer.category}</Tag>}
            </div>
          )}
          {single && offer.description && (
            <p className="line-clamp-2 text-[13px] leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>
              {richTextToPlainText(offer.description)}
            </p>
          )}
        </ResultCard>
      )}
    />
  );
}

export function CooperationResults({ items }: { items: CooperationItem[] }) {
  const typeCounts = new Map<string, number>();
  for (const item of items) {
    const t = item.cooperationType ?? 'unknown';
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }

  return (
    <ResultGrid
      items={items}
      noun={['cooperation', 'cooperations']}
      footer={
        <>
          {typeCounts.size > 1 && Array.from(typeCounts.entries()).map(([type, count]) => (
            <DomainFilterLink key={type} domain="cooperate" label={`${type} (${count})`} coopType={type.toLowerCase()} />
          ))}
          <DomainFilterLink domain="cooperate" />
        </>
      }
      renderItem={coop => {
        const colors = TYPE_COLORS[coop.cooperationType?.toLowerCase() ?? ''];
        return (
          <ResultCard to={`/coop/${coop.id}`} title={coop.title} thumb={pickThumb(coop)} status={coop.status}>
            {coop.budgetSats != null && <SatsAmount sats={coop.budgetSats} size="sm" />}
            {coop.cooperationType && (
              <div className="flex min-w-0 flex-wrap gap-1">
                <Tag color={colors?.text} bg={colors?.bg}>{coop.cooperationType}</Tag>
              </div>
            )}
          </ResultCard>
        );
      }}
    />
  );
}
