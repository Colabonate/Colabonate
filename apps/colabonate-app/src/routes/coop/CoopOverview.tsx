// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
// Cooperation Overview – /coop/overview (ADR-218 D3/D4/D9; formerly the "Overview" tab of ADR-110's CoopDashboard)

import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Handshake, ArrowRight, Shield, Radio, FolderKanban,
  Network, Users, FileText, Layers, Compass, Bitcoin, Briefcase, Tag, TrendingUp, Settings,
} from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { CoopFAB } from '../../components/ui'
import { cn } from '@ds/utils'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useCooperationsForProjects } from '../../hooks/useEntityQueries'

const FEATURE_SECTIONS = [
  {
    title: 'Cooperation Guide',
    description: 'Start a new cooperation with the 3-step guide. Choose your role, type, and action to create protocol-conformant cooperations.',
    icon: Compass,
    link: '/coop/guide',
    color: 'var(--color-primary-50)',
    bg: 'rgba(99,179,237,0.12)',
    features: ['3-step wizard', 'Protocol forms', 'Role-based'],
    badge: 'START',
  },
  {
    title: 'Projects',
    description: 'Create or join shared projects with defined milestones, timelines, and partner allocation.',
    icon: FolderKanban,
    link: '/coop/projects',
    color: 'var(--color-status-success)',
    bg: 'rgba(72,187,120,0.12)',
    features: ['Milestones', 'Timeline', 'Skills matching'],
  },
  {
    title: 'Tenders',
    description: 'Publish open calls for proposals or apply to existing tenders. Partners apply on milestones.',
    icon: Handshake,
    link: '/coop/tenders',
    color: 'var(--color-secondary-50)',
    bg: 'rgba(159,122,234,0.12)',
    features: ['Open call', 'Milestone applications', 'Partner selection'],
  },
  {
    title: 'Networks',
    description: 'Build professional networks and communities. Open or closed membership with shared goals.',
    icon: Network,
    link: '/coop/networks',
    color: 'var(--color-warning-primary)',
    bg: 'rgba(255,192,57,0.12)',
    features: ['Open/closed', 'Member management', 'Community'],
  },
  {
    title: 'Partners',
    description: 'Find and manage cooperation partners in your area. Build trusted relationships for future projects.',
    icon: Users,
    link: '/coop?filter=partners',
    color: 'var(--color-info-primary)',
    bg: 'rgba(56,189,248,0.12)',
    features: ['Local discovery', 'Trust scores', 'Reviews'],
  },
  {
    title: 'Templates',
    description: 'Save and reuse cooperation configurations and contract templates for faster setup.',
    icon: FileText,
    link: '/coop/templates',
    color: 'var(--color-neutral-5)',
    bg: 'rgba(113,128,150,0.12)',
    features: ['Setup templates', 'Contracts', 'Quick start'],
  },
  {
    title: 'Manage Cooperations',
    description: 'View and manage all your active projects, tenders, and networks in one place. Edit, archive, or track progress.',
    icon: Settings,
    // ADR-368 D1: the manage hub is /coop/manage (cooperations tab).
    link: '/coop/manage?tab=cooperations',
    color: 'var(--color-primary-50)',
    bg: 'rgba(99,179,237,0.12)',
    features: ['All types', 'Status tracking', 'Quick edit'],
    badge: 'MANAGE',
  },
]

const TECH_HIGHLIGHTS = [
  {
    icon: Layers,
    title: 'Milestone Payments',
    description: 'Pay per milestone — funds are released as work progresses. Full budget transparency for all parties.',
    color: 'var(--color-status-success)',
    bg: 'rgba(72,187,120,0.08)',
  },
  {
    icon: Radio,
    title: 'Nostr Protocol',
    description: 'Cooperations are published to Nostr relays. Portable, censorship-resistant, and discoverable across the network.',
    color: 'var(--color-secondary-50)',
    bg: 'rgba(159,122,234,0.08)',
  },
  {
    icon: Bitcoin,
    title: 'Milestone Payments',
    description: 'Pay partners directly over Lightning, milestone by milestone as work is completed. Escrow is coming soon.',
    color: 'var(--color-warning-primary)',
    bg: 'rgba(255,192,57,0.08)',
  },
  {
    icon: Shield,
    title: 'Mutual Reviews',
    description: 'Both parties review each other after completion. Build reputation that is bound to your Nostr identity.',
    color: 'var(--color-info-primary)',
    bg: 'rgba(56,189,248,0.08)',
  },
]

export function CoopOverview() {
  const navigate = useNavigate()
  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '')
  // ADR-324 FU-408: canonical `['cooperations', pubkey]` cache (30s poll,
  // first=100) instead of a mount-only plain fetch.
  const { data: coopList = [], isLoading } = useCooperationsForProjects(pubkey)
  const loading = pubkey ? isLoading : false

  const dashboardRef = usePageAnimation([
    { selector: '.dashboard-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  useEffect(() => {
    try {
      const key = 'kpi-coop-dashboard'
      const existing: string[] = JSON.parse(localStorage.getItem(key) || '[]')
      const sections = ['My Cooperations', 'Finances']
      const merged = [...new Set([...existing, ...sections])]
      localStorage.setItem(key, JSON.stringify(merged))
    } catch { /* ignore */ }
  }, [])

  const kpiItems = useMemo(() => {
    const openCount = coopList.filter((o: any) => o.status === 'OPEN').length
    const activeCount = coopList.filter((o: any) => ['ACCEPTED','PAID','IN_PROGRESS'].includes(o.status)).length
    const disputedCount = coopList.filter((o: any) => o.status === 'DISPUTED').length
    const completedCount = coopList.filter((o: any) => o.status === 'COMPLETED').length
    const closedCount = coopList.filter((o: any) => ['CANCELLED','CLOSED','DRAFT'].includes(o.status)).length
    const incomeSats = coopList.filter((o: any) => o.initiatorPubkey === pubkey && !['CANCELLED','DRAFT'].includes(o.status)).reduce((s: number, o: any) => s + (o.budgetSats ?? 0), 0)
    const expenseSats = coopList.filter((o: any) => o.partnerPubkey === pubkey && !['CANCELLED','DRAFT'].includes(o.status)).reduce((s: number, o: any) => s + (o.budgetSats ?? 0), 0)
    return [
      { icon: <Handshake size={14} />, value: coopList.length, label: 'All', heading: 'My Cooperations' },
      { icon: <Tag size={14} />, value: openCount, label: 'Open', color: 'var(--color-status-success)' },
      { icon: <TrendingUp size={14} />, value: activeCount, label: 'Active', color: 'var(--color-primary-50)' },
      { icon: <Shield size={14} />, value: disputedCount, label: 'Disputed', color: 'var(--color-error-primary)' },
      { icon: <Layers size={14} />, value: completedCount, label: 'Completed', color: 'var(--color-secondary-50)' },
      { icon: <FileText size={14} />, value: closedCount, label: 'Closed', color: 'var(--theme-text-muted)' },
      { icon: <TrendingUp size={14} />, value: incomeSats, label: 'Income', color: 'var(--color-status-success)', tooltip: `${incomeSats.toLocaleString('de-DE')} sats received as initiator`, heading: 'Finances', separator: true },
      { icon: <TrendingUp size={14} />, value: expenseSats, label: 'Expenses', color: 'var(--color-error-primary)', tooltip: `${expenseSats.toLocaleString('de-DE')} sats committed as partner` },
    ] satisfies KPIItem[]
  }, [coopList, pubkey])

  return (
    // Top spacing = 0 like /bounties (user feedback 2026-08-24): flush under
    // the desktop top bar / 16px mobile edge via Layout's main padding.
    <PageContainer size="wide" spacing="lg" className="pt-0!" ref={dashboardRef}>
      <div className="dashboard-animate">
        <PageHeader
          icon={<Handshake size={18} />}
          title="Cooperate Overview"
          subtitle="KPIs, tools and quick actions"
          onBack={() => navigate('/coop')}
        />

        <KPIStrip
          items={kpiItems}
          loading={loading}
          skeletonCount={6}
          wrap
          collapsible
          storageKey="kpi-coop-dashboard"
          className="mt-2"
        />

        <div className="mt-6">
          {/* CTA Banner */}
          <Link
            to="/coop/guide"
            className={cn(
              'flex items-center justify-between p-6 rounded-xl mb-8 no-underline',
              'transition-all duration-200 cursor-pointer',
              'hover:-translate-y-0.5 hover:shadow-lg',
            )}
            style={{
              background: 'linear-gradient(135deg, var(--color-primary-50), var(--color-secondary-50))',
            }}
          >
            <div>
              <h3 className="text-[18px] font-semibold mb-1" style={{ color: 'white' }}>
                Start a New Cooperation
              </h3>
              <p
                className="text-[13px]"
                style={{ color: 'rgba(255,255,255,0.85)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                Use the 3-step guide to create protocol-conformant cooperations
              </p>
            </div>
            <ArrowRight size={24} style={{ color: 'white' }} />
          </Link>

          {/* Introduction */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <Briefcase size={24} style={{ color: 'var(--color-primary-50)' }} />
              <h2 className="text-[22px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                Cooperate on Colabonate
              </h2>
            </div>
            <p
              className="text-[14px] leading-relaxed mb-6"
              style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              Colabonate enables structured collaboration with{' '}
              <strong style={{ color: 'var(--color-status-success)' }}>milestone-based payments</strong> and
              <strong style={{ color: 'var(--color-secondary-50)' }}> Nostr publishing</strong>. Create projects,
              publish offers, build networks — all secured by{' '}
              <strong style={{ color: 'var(--color-warning-primary)' }}>Bitcoin Lightning</strong> escrow
              with transparent tracking and mutual reviews.
            </p>

            {/* Tech Highlights */}
            <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-2">
              {TECH_HIGHLIGHTS.map(item => (
                <div
                  key={item.title}
                  className="flex items-start gap-3 p-4 rounded-xl"
                  style={{ background: item.bg }}
                >
                  <div
                    className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
                    style={{ background: 'var(--theme-surface)' }}
                  >
                    <item.icon size={20} style={{ color: item.color }} />
                  </div>
                  <div>
                    <h4 className="text-[13px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>
                      {item.title}
                    </h4>
                    <p
                      className="text-[12px] leading-relaxed"
                      style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                    >
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Feature Sections */}
          <div>
            <h3 className="text-[16px] font-semibold mb-4" style={{ color: 'var(--theme-text)' }}>
              Cooperation Tools
            </h3>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {FEATURE_SECTIONS.map(section => (
                <Link
                  key={section.title}
                  to={section.link}
                  className={cn(
                    'group flex flex-col p-5 rounded-xl border no-underline cursor-pointer',
                    'transition-all duration-200',
                    'hover:-translate-y-1 hover:shadow-lg',
                  )}
                  style={{
                    border: '1px solid var(--theme-border)',
                    background: 'var(--theme-surface)',
                  }}
                >
                  <div className="flex items-start gap-4 mb-4">
                    <div
                      className="flex items-center justify-center w-12 h-12 transition-transform duration-200 rounded-xl shrink-0 group-hover:scale-105"
                      style={{ background: section.bg }}
                    >
                      <section.icon size={24} style={{ color: section.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-[16px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                          {section.title}
                        </h4>
                        {'badge' in section && section.badge && (
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
                            style={{ background: 'var(--color-primary-50)', color: 'white' }}
                          >
                            {section.badge}
                          </span>
                        )}
                      </div>
                      <p
                        className="text-[13px] leading-relaxed"
                        style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                      >
                        {section.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-3">
                    {section.features.map(feature => (
                      <span
                        key={feature}
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium"
                        style={{
                          background: 'var(--theme-bg-subtle)',
                          color: 'var(--theme-text-muted)',
                          fontFamily: 'var(--typography-fontfamily-sans)',
                        }}
                      >
                        {feature}
                      </span>
                    ))}
                  </div>

                  <div
                    className="flex items-center gap-2 text-[13px] font-medium transition-all duration-200"
                    style={{ color: section.color }}
                  >
                    <span>Go to {section.title}</span>
                    <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-1" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <CoopFAB />
    </PageContainer>
  )
}
