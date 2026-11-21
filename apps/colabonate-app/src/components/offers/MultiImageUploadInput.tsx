import { useRef, useState } from 'react'
import {
  Box,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import CheckCircleIcon       from '@mui/icons-material/CheckCircle'
import DeleteIcon            from '@mui/icons-material/Delete'
import StarIcon              from '@mui/icons-material/Star'
import { optimizeImage } from '../../hooks/useImageOptimizer'

interface MultiImageUploadInputProps {
  values: string[]
  onChange: (urls: string[]) => void
  maxImages?: number
  /** Index of the primary image (shown as cover in listings) */
  primaryIndex?: number
  onPrimaryChange?: (index: number) => void
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_INPUT_BYTES = 20 * 1024 * 1024

const TILE_SIZE = 96   // px — width & height of each tile
const TILE_RADIUS = 'var(--radius-md, 8px)'

export function MultiImageUploadInput({
  values,
  onChange,
  maxImages = 5,
  primaryIndex = 0,
  onPrimaryChange,
}: MultiImageUploadInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const canAddMore = values.length < maxImages

  async function processFiles(files: FileList) {
    const allowed = Array.from(files)
      .filter(f => ACCEPTED.includes(f.type) && f.size <= MAX_INPUT_BYTES)
      .slice(0, maxImages - values.length)

    if (allowed.length === 0) {
      setErrorMsg('No valid images (JPG/PNG/WebP/GIF, max 20 MB).')
      return
    }

    setProcessing(true)
    setErrorMsg('')
    try {
      const dataUrls = await Promise.all(allowed.map(f => optimizeImage(f)))
      onChange([...values, ...dataUrls])
    } catch {
      setErrorMsg('One or more images could not be processed.')
    } finally {
      setProcessing(false)
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) processFiles(e.target.files)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files)
  }

  function removeImage(index: number) {
    const next = values.filter((_, i) => i !== index)
    onChange(next)
    if (onPrimaryChange) {
      if (index === primaryIndex) {
        onPrimaryChange(0)
      } else if (index < primaryIndex) {
        onPrimaryChange(primaryIndex - 1)
      }
    }
  }

  // ── 0 images: full-width drop zone ──────────────────────────────────────────
  if (values.length === 0) {
    return (
      <Box>
        <Box
          onClick={() => !processing && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          sx={{
            border: '2px dashed',
            borderColor: dragging ? 'primary.main' : 'divider',
            borderRadius: TILE_RADIUS,
            p: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.75,
            cursor: processing ? 'wait' : 'pointer',
            bgcolor: dragging ? 'action.hover' : 'background.paper',
            transition: 'border-color 200ms, background-color 200ms',
            '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
          }}
        >
          {processing
            ? <CircularProgress size={28} />
            : <AddPhotoAlternateIcon sx={{ fontSize: 32, color: 'text.disabled' }} />}
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {processing ? 'Optimizing photos…' : 'Drop photos here or click to select'}
          </Typography>
          <Typography variant="caption" color="text.disabled">
            JPG · PNG · WebP · GIF · max 20 MB · up to {maxImages} photos
          </Typography>
        </Box>
        {errorMsg && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.75 }}>
            {errorMsg}
          </Typography>
        )}
        <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} multiple style={{ display: 'none' }} onChange={handleFileInput} />
      </Box>
    )
  }

  // ── 1–5 images: tile row + add slot ─────────────────────────────────────────
  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>

        {/* Filled image tiles */}
        {values.map((url, i) => {
          const isPrimary = i === primaryIndex
          const canSetPrimary = onPrimaryChange && !isPrimary
          return (
            <Box
              key={i}
              onClick={() => canSetPrimary && onPrimaryChange(i)}
              sx={{
                position: 'relative',
                width: TILE_SIZE,
                height: TILE_SIZE,
                borderRadius: TILE_RADIUS,
                overflow: 'hidden',
                flexShrink: 0,
                cursor: canSetPrimary ? 'pointer' : 'default',
                outline: isPrimary ? '2.5px solid' : '1.5px solid',
                outlineColor: isPrimary ? 'primary.main' : 'divider',
                outlineOffset: isPrimary ? '2px' : '0px',
                transition: 'outline-color 150ms',
                '&:hover .cover-hint': { opacity: canSetPrimary ? 1 : 0 },
              }}
            >
              <img
                src={url}
                alt={`Photo ${i + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />

              {/* Cover badge */}
              {isPrimary && (
                <Box sx={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  px: 0.75, py: 0.35,
                  bgcolor: 'primary.main',
                  display: 'flex', alignItems: 'center', gap: 0.4,
                }}>
                  <StarIcon sx={{ fontSize: 9, color: '#fff' }} />
                  <Typography sx={{ fontSize: '0.6rem', color: '#fff', fontWeight: 700, lineHeight: 1 }}>
                    Cover
                  </Typography>
                </Box>
              )}

              {/* Hover: set as cover */}
              {canSetPrimary && (
                <Box className="cover-hint" sx={{
                  position: 'absolute', inset: 0,
                  bgcolor: 'rgba(0,0,0,0.42)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 0.4,
                  opacity: 0, transition: 'opacity 150ms',
                }}>
                  <CheckCircleIcon sx={{ fontSize: 18, color: '#fff' }} />
                  <Typography sx={{ fontSize: '0.6rem', color: '#fff', fontWeight: 600, lineHeight: 1.2 }}>
                    Set as cover
                  </Typography>
                </Box>
              )}

              {/* Delete */}
              <Tooltip title="Remove" placement="top">
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); removeImage(i) }}
                  sx={{
                    position: 'absolute', top: 3, right: 3,
                    bgcolor: 'rgba(0,0,0,0.5)', color: '#fff', p: 0.3,
                    transition: 'background-color 150ms',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                  }}
                >
                  <DeleteIcon sx={{ fontSize: 13 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )
        })}

        {/* Add slot — compact tile, disappears at maxImages */}
        {canAddMore && (
          <Box
            onClick={() => !processing && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            sx={{
              width: TILE_SIZE,
              height: TILE_SIZE,
              borderRadius: TILE_RADIUS,
              border: '2px dashed',
              borderColor: dragging ? 'primary.main' : 'divider',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.5,
              cursor: processing ? 'wait' : 'pointer',
              bgcolor: dragging ? 'action.hover' : 'background.paper',
              flexShrink: 0,
              transition: 'border-color 200ms, background-color 200ms',
              '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
            }}
          >
            {processing
              ? <CircularProgress size={18} />
              : <AddPhotoAlternateIcon sx={{ fontSize: 22, color: 'text.disabled' }} />}
            <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', lineHeight: 1.2, textAlign: 'center', px: 0.5 }}>
              {processing ? '…' : `${values.length}/${maxImages}`}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Cover hint text — only when multiple images present */}
      {values.length > 1 && onPrimaryChange && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Click a photo to set it as the cover shown in listings.
        </Typography>
      )}

      {errorMsg && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.75 }}>
          {errorMsg}
        </Typography>
      )}

      <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} multiple style={{ display: 'none' }} onChange={handleFileInput} />
    </Box>
  )
}
