import { useCallback, useEffect } from 'react'
import { Box, IconButton, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary'
import { Modal, ModalContent } from '@ds/ui'

interface ImageLightboxProps {
  open: boolean
  onClose: () => void
  images: string[]
  index: number
  onIndexChange: (index: number) => void
  title?: string
}

export function ImageLightbox({ open, onClose, images, index, onIndexChange, title }: ImageLightboxProps) {
  const hasMultiple = images.length > 1

  const goPrev = useCallback(() => {
    if (images.length === 0) return
    onIndexChange((index - 1 + images.length) % images.length)
  }, [index, images.length, onIndexChange])

  const goNext = useCallback(() => {
    if (images.length === 0) return
    onIndexChange((index + 1) % images.length)
  }, [index, images.length, onIndexChange])

  useEffect(() => {
    if (!open || !hasMultiple) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, hasMultiple, goPrev, goNext])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {title}
        </Box>
      }
      maxWidth={false}
      onClick={(e: React.MouseEvent) => {
        // Click anywhere in the dialog outside the visible image (letterbox,
        // padding, header) closes the lightbox. Buttons (arrows, close icon)
        // keep their own handlers and are excluded here.
        if ((e.target as HTMLElement).closest('img, button')) return
        onClose()
      }}
    >
      <ModalContent disablePadding>
        <Box
          onClick={(e: React.MouseEvent) => { if ((e.target as HTMLElement).closest('img, button')) return; onClose() }}
          sx={{ position: 'relative', display: 'flex', justifyContent: 'center', px: { xs: 1, sm: 2 }, pb: { xs: 1, sm: 2 }, cursor: 'zoom-out' }}
        >
          <Box
            component="img"
            src={images[index]}
            alt={title ?? ''}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            sx={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: { xs: 'calc(100dvh - 150px)', sm: 'calc(100dvh - 170px)' },
              width: 'auto',
              height: 'auto',
              cursor: 'default',
              borderRadius: 'var(--radius-md, 8px)',
            }}
          />

          {hasMultiple && (
            <IconButton
              size="small"
              onClick={goPrev}
              aria-label="Previous image"
              sx={{
                position: 'absolute',
                left: { xs: 6, sm: 16 },
                top: '50%',
                transform: 'translateY(-50%)',
                bgcolor: 'rgba(0,0,0,0.45)',
                color: '#fff',
                backdropFilter: 'blur(4px)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' },
              }}
            >
              <ChevronLeftIcon />
            </IconButton>
          )}

          {hasMultiple && (
            <IconButton
              size="small"
              onClick={goNext}
              aria-label="Next image"
              sx={{
                position: 'absolute',
                right: { xs: 6, sm: 16 },
                top: '50%',
                transform: 'translateY(-50%)',
                bgcolor: 'rgba(0,0,0,0.45)',
                color: '#fff',
                backdropFilter: 'blur(4px)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' },
              }}
            >
              <ChevronRightIcon />
            </IconButton>
          )}

          {hasMultiple && (
            <Box sx={{
              position: 'absolute',
              bottom: { xs: 10, sm: 18 },
              right: { xs: 6, sm: 16 },
              display: 'flex', alignItems: 'center', gap: 0.75,
              bgcolor: 'rgba(0,0,0,0.52)', borderRadius: '8px',
              px: 1.25, py: 0.6, backdropFilter: 'blur(4px)', pointerEvents: 'none',
            }}>
              <PhotoLibraryIcon sx={{ fontSize: 15, color: '#fff' }} />
              <Typography sx={{ fontSize: '0.75rem', color: '#fff', fontWeight: 600, lineHeight: 1 }}>
                {index + 1} / {images.length}
              </Typography>
            </Box>
          )}
        </Box>
      </ModalContent>
    </Modal>
  )
}
