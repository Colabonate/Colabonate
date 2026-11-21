import { useState, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@mui/material'
import { ManageSearch } from '@mui/icons-material'
import { Zap } from 'lucide-react'

import { CARD_THEME } from '@ds/ui'
import { useTheme } from '@ds/utils'

import { SearchHeroBar } from './SearchHeroBar'
import { SearchQuickChips } from './SearchQuickChips'
import { CustomTipModal } from './CustomTipModal'
import { useSectionAnimation } from '../../hooks/usePageAnimation'
import { useSupportTip } from '../../hooks/useSupportTip'
import { SEARCH_CHIPS } from '../../config/search-chips'

const BACKGROUND_LOGO_IMAGE = new URL('../../assets/Colabonate_Logo_7_04.webp', import.meta.url).href

export const SearchHeroSection = memo(function SearchHeroSection() {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const sectionRef = useSectionAnimation('.search-hero-card', {
    scrollTrigger: true,
    start: 'top 90%',
    from: { y: 24, duration: 0.5, stagger: 0.08 },
  })

  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const { configured, available, state, pendingAmount, sendTip } = useSupportTip()
  const [customTipOpen, setCustomTipOpen] = useState(false)

  function handleSubmit(value: string) {
    const trimmed = value.trim()
    const params = new URLSearchParams()
    if (trimmed) params.set('q', trimmed)
    navigate(params.toString() ? `/search?${params.toString()}` : '/search')
  }

  function handleOfferSelect(offerId: string) {
    navigate(`/offers/${offerId}`)
  }

  return (
    <>
      <section ref={sectionRef} aria-label="Search" className="search-hero mt-0 mb-0 xl:max-w-4xl xl:mx-0 h-full">
      <div
        className="search-hero-card relative rounded-2xl p-3 md:p-4 h-full"
        style={{ boxShadow: CARD_THEME.shadow }}
      >
        <div className="absolute inset-0 rounded-2xl overflow-hidden">
          <img
            src={BACKGROUND_LOGO_IMAGE}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-[500px] h-[500px] object-contain blur-[1px] translate-x-[80%] translate-y-[-20%] xl:translate-y-[-100px] xl:translate-x-[80%]"
          />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'color-mix(in srgb, var(--theme-bg) 18%, transparent)' }}
          />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: CARD_THEME.overlay(theme), opacity: 0.2 }}
          />
        </div>

        <div className="relative z-10 flex flex-col gap-2 md:gap-3">
          <div className="relative">
            {searchFocused && (
              <div
                aria-hidden="true"
                className="search-hero-glow pointer-events-none absolute -inset-[3px] rounded-[11px]"
              />
            )}
            <SearchHeroBar
              value={query}
              onChange={setQuery}
              onSubmit={handleSubmit}
              onOfferSelect={handleOfferSelect}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              className="relative z-10 w-full"
            />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[auto_auto_minmax(0,1fr)] gap-2 md:gap-3 items-center">
            <Button
              variant="outlined"
              fullWidth
              endIcon={<ManageSearch />}
              onClick={() => navigate('/search')}
              sx={{
                color: 'var(--color-primary-50)',
                borderColor: 'color-mix(in srgb, var(--color-primary-50) 40%, transparent)',
                backgroundColor: 'color-mix(in srgb, var(--theme-bg-subtle) 30%, transparent)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                textTransform: 'none',
                fontWeight: 'var(--typography-paragraph-small-heavy-fontweight)',
                fontSize: 'var(--typography-paragraph-small-heavy-fontsize)',
                lineHeight: 'var(--typography-paragraph-small-heavy-lineheight)',
                borderRadius: '8px',
                whiteSpace: 'nowrap',
                paddingInline: '14px',
                flexShrink: 0,
                '&:hover': {
                  backgroundColor: 'color-mix(in srgb, var(--color-primary-50) 10%, transparent)',
                  borderColor: 'var(--color-primary-50)',
                },
              }}
            >
              Explore
            </Button>

            {/* Reachable whenever a donation address is configured for this
                build; without a connected wallet the modal explains the gate
                instead of failing on send (ADR-247). On mobile it sits inline to
                the right of Explore (Explore takes the remaining width); from md
                it shares the row with Explore and the quick-search chips. */}
            {configured && (
              <Button
                variant="outlined"
                fullWidth
                endIcon={<Zap size={16} />}
                onClick={() => setCustomTipOpen(true)}
                sx={{
                  color: 'var(--color-accent-3)',
                  borderColor: 'color-mix(in srgb, var(--color-accent-3) 40%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--color-accent-3) 10%, transparent)',
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                  textTransform: 'none',
                  fontWeight: 'var(--typography-paragraph-small-heavy-fontweight)',
                  fontSize: 'var(--typography-paragraph-small-heavy-fontsize)',
                  lineHeight: 'var(--typography-paragraph-small-heavy-lineheight)',
                  borderRadius: '8px',
                  whiteSpace: 'nowrap',
                  paddingInline: '14px',
                  flexShrink: 0,
                  '&:hover': {
                    backgroundColor: 'color-mix(in srgb, var(--color-accent-3) 18%, transparent)',
                    borderColor: 'var(--color-accent-3)',
                  },
                }}
              >
                Support
              </Button>
            )}

            {/* Mobile shows these chips lower down, below the Services & Collaborations
                tab bar (Home.tsx) instead — keeps the compact hero card uncluttered. */}
            <SearchQuickChips
              chips={SEARCH_CHIPS}
              className="col-span-2 md:col-span-1 hidden md:flex md:justify-end"
            />
          </div>
        </div>
      </div>
    </section>

    <CustomTipModal
      open={customTipOpen}
      onClose={() => setCustomTipOpen(false)}
      available={available}
      sendTip={sendTip}
      sending={state === 'sending'}
      pendingAmount={pendingAmount}
    />

      <style>{`
        @keyframes searchHeroGlow {
          0%, 100% { box-shadow: 0 0 4px 0 color-mix(in srgb, var(--color-primary-50) 35%, transparent); }
          50%      { box-shadow: 0 0 12px 2px color-mix(in srgb, var(--color-primary-50) 55%, transparent); }
        }
        .search-hero-glow { animation: searchHeroGlow 2.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .search-hero-glow { animation: none; }
        }
      `}</style>
    </>
  )
})
