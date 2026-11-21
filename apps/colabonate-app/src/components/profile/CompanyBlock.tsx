import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AddressBlock, OpeningHours, TermsBlock } from '@ds/ui'
import { cn } from '@ds/utils'
import LanguageIcon from '@mui/icons-material/Language'
import EmailIcon from '@mui/icons-material/Email'
import PhoneIcon from '@mui/icons-material/Phone'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import ArrowRightIcon from '@mui/icons-material/ArrowRight'
import ScheduleIcon from '@mui/icons-material/Schedule'
import StorefrontIcon from '@mui/icons-material/Storefront'
import PersonIcon from '@mui/icons-material/Person'
import type { Company } from '../../types/api'
import { parseJsonField } from '../../routes/coop/coop-cards'
import { DetailImageGallery } from '../../components/media/DetailImageGallery'

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function getTodayHours(parsedHours: Record<string, { start: string; end: string } | null> | null | undefined): string | null {
  if (!parsedHours) return null
  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
  const h = parsedHours[DAY_ORDER[todayIdx]]
  return h ? `${h.start} – ${h.end}` : 'Closed'
}

// ADR-367 D1: the single read-only Company identity block, shared by
// /u/:pubkey (inline), /c/:companyId (standalone) and /sell/company (overview).
//
// One unified hero card = DetailImageGallery (banner + company images,
// crossfade auto-carousel + lightbox) + identity + meta chips + owner footer,
// then About / Details / Terms. Offers/content stay out (D8 renders them via
// the unified ListBrowser).
export interface CompanyBlockProps {
  company: Company
  /** Extra nodes rendered right of the title (e.g. SellCompany's Active/Inactive badge). */
  headerBadges?: ReactNode
  /** When set, renders a "View public profile" link to this path. */
  viewProfileTo?: string
  /** Owner teaser rendered as a footer inside the hero (who owns this company). */
  owner?: { pubkey: string; displayName?: string | null }
}

function Section({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)]',
        'px-6 py-5 md:px-8 md:py-6',
        className,
      )}
    >
      <span className="block text-[13px] uppercase tracking-wide font-semibold text-[var(--theme-text-muted)] mb-2">
        {label}
      </span>
      {children}
    </div>
  )
}

function MetaChip({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'success' }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium"
      style={{
        background: 'var(--theme-bg-subtle)',
        color: tone === 'success' ? 'var(--color-status-success)' : 'var(--theme-text)',
        border: '1px solid var(--theme-border)',
      }}
    >
      {children}
    </span>
  )
}

export function CompanyBlock({
  company,
  headerBadges,
  viewProfileTo,
  owner,
}: CompanyBlockProps) {
  const hasLocation = Boolean(company.city || company.country)
  // ADR-229: businessFields/openingHours/images are Prisma Json? fields that may
  // arrive stringified on legacy rows — normalize before rendering.
  const businessFields = parseJsonField<Company['businessFields']>(company.businessFields, []) ?? []
  const openingHours = parseJsonField<Company['openingHours']>(company.openingHours, undefined)
  const images = parseJsonField<string[]>(company.images, []) ?? []
  const hasBusinessFields = businessFields.length > 0
  const hasOpeningHours = Boolean(openingHours && Object.keys(openingHours).length > 0)
  const hasContact = Boolean(company.website || company.email || company.phone)
  const todayHours = getTodayHours(openingHours)

  // Hero = banner first, then the company gallery (same order the old
  // /buy/vendors/:pubkey hero used).
  const heroImages: string[] = []
  if (company.bannerUrl) heroImages.push(company.bannerUrl)
  for (const img of images) if (img) heroImages.push(img)

  // Business fields + today's hours render as hero chips, so Details only holds
  // the address / full opening hours / contact.
  const hasDetails = Boolean(company.address || hasOpeningHours || hasContact)

  const locationNode = hasLocation ? (
    <div className="flex items-center gap-1 mt-1 text-[13px] text-[var(--theme-text-muted)]">
      <LocationOnIcon sx={{ fontSize: 14 }} />
      {company.city}{company.country ? `, ${company.country}` : ''}
    </div>
  ) : undefined

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      {/* Unified hero — gallery + identity + meta chips + owner as one section. */}
      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] overflow-hidden">
        {heroImages.length > 0 ? (
          <DetailImageGallery
            images={heroImages}
            title={company.name}
            heights={{ xs: 220, sm: 320, md: 380 }}
            counterIcon={<StorefrontIcon sx={{ fontSize: 15, color: '#fff' }} />}
          />
        ) : (
          <div
            className="w-full flex items-center justify-center bg-[var(--theme-bg-subtle)]"
            style={{ height: 220 }}
          >
            <StorefrontIcon sx={{ fontSize: 64, color: 'var(--theme-text-muted)', opacity: 0.4 }} />
          </div>
        )}

        <div className="px-6 py-5 md:px-8 md:py-6">
          <div className="flex flex-wrap items-start gap-4">
            <div
              className="flex items-center justify-center w-16 h-16 rounded-xl border flex-shrink-0 overflow-hidden"
              style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--color-primary-10)', color: 'var(--color-primary-50)' }}
            >
              {company.logoUrl ? (
                <img src={company.logoUrl} alt="" aria-hidden className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <StorefrontIcon sx={{ fontSize: 28 }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[20px] font-semibold text-[var(--theme-text)] truncate">
                  {company.name}
                </span>
                {headerBadges}
              </div>
              {locationNode}
            </div>
          </div>

          {(hasBusinessFields || todayHours) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-4">
              {businessFields.map((f) => (
                <MetaChip key={f.id ?? f.slug ?? f.name}>{f.name}</MetaChip>
              ))}
              {todayHours && (
                <MetaChip tone="success">
                  <ScheduleIcon sx={{ fontSize: 13 }} />
                  Today: {todayHours}
                </MetaChip>
              )}
            </div>
          )}

          {owner && (
            <div className="flex flex-wrap items-center gap-3 border-t mt-4 pt-4" style={{ borderColor: 'var(--theme-border)' }}>
              <div
                className="flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
                style={{ backgroundColor: 'var(--color-primary-10)', color: 'var(--color-primary-50)' }}
              >
                <PersonIcon sx={{ fontSize: 18 }} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="block text-[11px] uppercase tracking-wide font-semibold text-[var(--theme-text-muted)]">
                  Owner
                </span>
                <span className="block text-[13px] font-semibold text-[var(--theme-text)] truncate">
                  {owner.displayName ?? `${owner.pubkey.slice(0, 8)}…`}
                </span>
              </div>
              <Link
                to={`/u/${owner.pubkey}`}
                className="inline-flex items-center gap-1 text-[13px] font-medium px-4 py-2 rounded-lg no-underline"
                style={{ backgroundColor: 'var(--color-primary-10)', color: 'var(--color-primary-50)' }}
              >
                View profile
                <ArrowRightIcon sx={{ fontSize: 16 }} />
              </Link>
            </div>
          )}
        </div>
      </div>

      {company.description && (
        <Section label="About">
          <p className="text-[15px] leading-[1.6] text-[var(--theme-text)] whitespace-pre-line">
            {company.description}
          </p>
        </Section>
      )}

      {hasDetails && (
        <Section label="Details">
          <div className="flex flex-col gap-5">
            {(company.address || hasOpeningHours) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <AddressBlock
                  address={company.address}
                  zipCode={company.zipCode}
                  city={company.city}
                  country={company.country}
                />
                {hasOpeningHours && (
                  <OpeningHours hours={openingHours} />
                )}
              </div>
            )}

            {hasContact && (
              <div className="flex flex-col gap-2 text-[14px] text-[var(--theme-text)] border-t pt-4" style={{ borderColor: 'var(--theme-border)' }}>
                {company.website && (
                  <div className="flex items-center gap-2">
                    <LanguageIcon sx={{ fontSize: 16, color: 'var(--theme-text-muted)' }} />
                    <a href={company.website} target="_blank" rel="noreferrer" className="text-[var(--color-primary-50)] underline truncate">
                      {company.website}
                    </a>
                  </div>
                )}
                {company.email && (
                  <div className="flex items-center gap-2">
                    <EmailIcon sx={{ fontSize: 16, color: 'var(--theme-text-muted)' }} />
                    <a href={`mailto:${company.email}`} className="text-[var(--color-primary-50)] underline truncate">
                      {company.email}
                    </a>
                  </div>
                )}
                {company.phone && (
                  <div className="flex items-center gap-2">
                    <PhoneIcon sx={{ fontSize: 16, color: 'var(--theme-text-muted)' }} />
                    <span className="truncate">{company.phone}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      {company.terms && (
        <Section label="Terms & Conditions">
          <TermsBlock terms={company.terms} showIcon={false} />
        </Section>
      )}

      {viewProfileTo && (
        <Link
          to={viewProfileTo}
          className="inline-flex items-center gap-1 text-[13px] font-medium no-underline text-[var(--color-primary-50)] hover:opacity-80 transition-opacity"
        >
          View public profile
          <ArrowRightIcon sx={{ fontSize: 16 }} />
        </Link>
      )}
    </div>
  )
}
