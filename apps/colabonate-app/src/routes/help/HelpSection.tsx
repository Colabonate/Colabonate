import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Box, Typography, TextField, InputAdornment, Button } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { PageContainer } from '@ds/ui'
import { NotFoundState } from '../../components/NotFoundState'
import { Seo } from '../../components/Seo'
import { cn } from '@ds/utils'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { getSection } from './helpData'
import { HelpBreadcrumb } from './HelpBreadcrumb'
import { HelpArticleAccordion } from './HelpArticleAccordion'
import { HelpArticleOpen } from './HelpArticleOpen'

export function HelpSection() {
  const { sectionId } = useParams<{ sectionId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useState('')

  const section = sectionId ? getSection(sectionId) : undefined

  const hashArticleId = location.hash.replace('#', '')

  const containerRef = usePageAnimation([
    { selector: '.help-section-animate', from: { duration: 0.4, stagger: 0.07, y: 16 } },
  ])

  const filteredArticles = useMemo(() => {
    if (!section) return []
    if (!search.trim()) return section.articles
    const q = search.toLowerCase()
    return section.articles.filter(
      a =>
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.content.toLowerCase().includes(q) ||
        a.tags.some(t => t.toLowerCase().includes(q)),
    )
  }, [section, search])

  useEffect(() => {
    if (!hashArticleId) return
    const el = document.getElementById(hashArticleId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [hashArticleId, filteredArticles])

  if (!section) {
    return (
      <NotFoundState
        title="Section not found"
        message="This help section may have been moved or removed."
        detail={sectionId ? `Section ${sectionId}` : undefined}
        primary={{ label: 'Back to help', to: '/help' }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  return (
    <>
      <Seo
        title={section.title}
        description={`Help and guides for ${section.title} on Colabonate — step-by-step articles for the peer-to-peer marketplace with Lightning payments and Nostr identity.`}
        path={`/help/${sectionId}`}
      />
    <PageContainer size="standard" spacing="lg">
      <Box ref={containerRef}>
        <Box className="help-section-animate mb-5">
          <Button
            onClick={() => navigate('/help')}
            startIcon={<ArrowBackIcon sx={{ fontSize: 16 }} />}
            className={cn(
              '!text-[length:var(--typography-paragraph-xsmall-heavy-fontsize)]',
              '!text-[var(--theme-text-muted)]',
              '!bg-transparent',
              '!border-none',
              '!p-0',
              '!mb-4',
              'hover:!text-[var(--theme-text)]',
              'hover:!bg-transparent',
            )}
          >
            Back to Help
          </Button>
          <HelpBreadcrumb sectionTitle={section.title} />
        </Box>

        <Box
          className={cn(
            'flex items-start gap-4',
            'p-5',
            'rounded-xl',
            'bg-[var(--theme-surface)]',
            'border border-[var(--theme-border)]',
            'help-section-animate',
          )}
          style={{ backgroundColor: section.bgColor }}
        >
          <Box
            className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
            sx={{ backgroundColor: section.iconBg }}
          >
            <Box sx={{ color: section.iconColor }}>
              {section.icon}
            </Box>
          </Box>
          <Box className="flex flex-col gap-2">
            <Typography
              className={cn(
                '!text-[length:var(--typography-heading-h3-mobile-heavy-fontsize)] !font-bold',
                'text-[var(--theme-text)]',
              )}
            >
              {section.title}
            </Typography>
            <Typography
              className={cn(
                '!text-[length:var(--typography-paragraph-base-regular-fontsize)]',
                'text-[var(--theme-text-muted)]',
                'leading-relaxed',
              )}
            >
              {section.description}
            </Typography>
          </Box>
        </Box>

        {section.id !== 'getting-started' && (
          <Box className="help-section-animate mt-7">
            <TextField
              fullWidth
              placeholder="Filter articles..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18, color: 'var(--theme-text-muted)' }}
                    />
                  </InputAdornment>
                ),
              }}
              className={cn(
                '!rounded-lg',
                '!bg-[var(--theme-surface)]',
                'help-article-filter',
              )}
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: 'var(--theme-surface)',
                  '& fieldset': {
                    borderColor: 'var(--theme-border)',
                  },
                  '&:hover fieldset': {
                    borderColor: 'var(--theme-text-muted)',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: section.color,
                  },
                },
                '& .MuiInputBase-input': {
                  fontSize: 'var(--typography-paragraph-small-regular-fontsize)',
                  color: 'var(--theme-text)',
                  '&::placeholder': {
                    color: 'var(--theme-text-muted)',
                    opacity: 1,
                  },
                },
              }}
            />
          </Box>
        )}

        <Box className="mt-7 flex flex-col gap-4 help-section-animate">
          {filteredArticles.length > 0 ? (
            filteredArticles.map(article =>
              article.layout === 'open' ? (
                <Box
                  key={article.id}
                  className="p-6 md:p-8 rounded-xl"
                  sx={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
                >
                  <HelpArticleOpen article={article} accentColor={section.color} />
                </Box>
              ) : (
                <HelpArticleAccordion
                  key={article.id}
                  article={article}
                  accentColor={section.color}
                  defaultExpanded={article.id === hashArticleId}
                />
              ),
            )
          ) : (
            <Box className="py-8 text-center">
              <Typography className="!text-[length:var(--typography-paragraph-base-regular-fontsize)] text-[var(--theme-text-muted)]">
                No articles match your search
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </PageContainer>
    </>
  )
}
