import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { ImageLightbox } from './ImageLightbox'

const AUTOPLAY_INTERVAL_MS = 4000

interface DetailImageGalleryProps {
  /** Image URLs; a single image disables carousel controls */
  images: string[]
  /** Alt text and lightbox title */
  title: string
  /** Responsive gallery heights per breakpoint (defaults: xs 280 / sm 420 / md 560) */
  heights?: { xs?: number; sm?: number; md?: number }
  /** Icon rendered inside the image counter chip (default: photo library) */
  counterIcon?: ReactNode
}

/**
 * Detail page hero image gallery with crossfade auto-carousel.
 *
 * Fades through the images automatically when there is more than one; the
 * play/pause toggle sits next to the thumbnail strip. Reduced-motion users
 * start paused. Clicking the active image opens the shared `ImageLightbox`
 * (same modal backdrop as every other dialog); auto-play pauses while the
 * lightbox is open.
 */
export function DetailImageGallery({ images, title, heights, counterIcon }: DetailImageGalleryProps) {
  const prefersReducedMotion = useReducedMotion()
  const [activeIndex, setActiveIndex] = useState(0)
  const [playing, setPlaying] = useState(() => !prefersReducedMotion)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const hasMultiple = images.length > 1

  // Keep the index in bounds when the image set changes (e.g. variant switch)
  useEffect(() => {
    if (activeIndex > images.length - 1) setActiveIndex(0)
  }, [images.length, activeIndex])

  // Auto-carousel: every index change (manual or automatic) restarts the
  // countdown so a freshly picked image is never replaced immediately.
  useEffect(() => {
    if (!playing || !hasMultiple || lightboxOpen) return
    const timer = setTimeout(() => {
      setActiveIndex(i => (i + 1) % images.length)
    }, AUTOPLAY_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [playing, hasMultiple, lightboxOpen, activeIndex, images.length])

  return (
    <Box sx={{
      position: 'relative',
      width: '100%',
      height: { xs: 280, sm: 420, md: 560, ...heights },
      borderRadius: 'var(--radius-lg, 12px)',
      overflow: 'hidden',
      bgcolor: 'var(--theme-bg-subtle)',
      border: '1px solid',
      borderColor: 'divider',
    }}>
      {images.map((url, i) => (
        <Box
          key={`${url}-${i}`}
          component="img"
          src={url}
          alt={i === activeIndex ? title : `Photo ${i + 1}`}
          onClick={() => setLightboxOpen(true)}
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          sx={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            opacity: i === activeIndex ? 1 : 0,
            transition: `opacity ${prefersReducedMotion ? 0 : 600}ms ease`,
            pointerEvents: i === activeIndex ? 'auto' : 'none',
            cursor: 'zoom-in',
          }}
        />
      ))}

      <Box sx={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0) 50%, rgba(0,0,0,0.55) 100%)',
        pointerEvents: 'none',
      }} />

      {hasMultiple && (
        <Box sx={{
          position: 'absolute', bottom: 14, right: 14,
          display: 'flex', alignItems: 'center', gap: 0.75,
          bgcolor: 'rgba(0,0,0,0.52)', borderRadius: '8px',
          px: 1.25, py: 0.6, backdropFilter: 'blur(4px)', pointerEvents: 'none',
        }}>
          {counterIcon ?? <PhotoLibraryIcon sx={{ fontSize: 15, color: '#fff' }} />}
          <Typography sx={{ fontSize: '0.75rem', color: '#fff', fontWeight: 600, lineHeight: 1 }}>
            {activeIndex + 1} / {images.length}
          </Typography>
        </Box>
      )}

      {hasMultiple && (
        <Box sx={{
          position: 'absolute', bottom: 12, left: 12,
          display: 'flex', alignItems: 'center', gap: 1,
          maxWidth: 'calc(100% - 110px)',
        }}>
          <Box sx={{
            display: 'flex', gap: 1, overflowX: 'auto',
            flexShrink: 1, minWidth: 0,
            scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
          }}>
            {images.map((url, i) => (
              <Box
                key={i}
                onClick={() => setActiveIndex(i)}
                sx={{
                  flexShrink: 0,
                  width: { xs: 56, sm: 72 },
                  height: { xs: 40, sm: 52 },
                  borderRadius: 1,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: '2px solid',
                  borderColor: i === activeIndex ? 'primary.main' : 'rgba(255,255,255,0.5)',
                  opacity: i === activeIndex ? 1 : 0.65,
                  transition: 'opacity 150ms, border-color 150ms',
                  boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
                  '&:hover': { opacity: 1, borderColor: i === activeIndex ? 'primary.main' : 'rgba(255,255,255,0.9)' },
                }}
              >
                <Box component="img" src={url} alt={`Photo ${i + 1}`} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </Box>
            ))}
          </Box>

          <Tooltip title={playing ? 'Pause auto-play' : 'Resume auto-play'} arrow>
            <IconButton
              size="small"
              onClick={() => setPlaying(p => !p)}
              aria-label={playing ? 'Pause auto-play' : 'Resume auto-play'}
              sx={{
                flexShrink: 0,
                width: 30, height: 30,
                bgcolor: 'rgba(0,0,0,0.52)',
                color: '#fff',
                backdropFilter: 'blur(4px)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
              }}
            >
              {playing ? <PauseIcon sx={{ fontSize: 17 }} /> : <PlayArrowIcon sx={{ fontSize: 17 }} />}
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <ImageLightbox
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        images={images}
        index={activeIndex}
        onIndexChange={setActiveIndex}
        title={title}
      />
    </Box>
  )
}
