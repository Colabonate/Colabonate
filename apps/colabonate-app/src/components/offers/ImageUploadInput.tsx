/**
 * ImageUploadInput
 *
 * Drag & Drop + File-Picker mit Browser-seitiger Bild-Optimierung.
 * Ruft optimizeImage() auf bevor onImageReady() gefeuert wird.
 * Gibt eine fertig komprimierte data-URL zurück (1280×960, JPEG 88%).
 */

import { useRef, useState } from 'react'
import {
  Box,
  CircularProgress,
  IconButton,
  Typography,
} from '@mui/material'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { optimizeImage, formatBytes, dataUrlBytes } from '../../hooks/useImageOptimizer'

interface ImageUploadInputProps {
  value: string
  onChange: (dataUrl: string) => void
  onClear: () => void
}

type UploadState = 'idle' | 'processing' | 'done' | 'error'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_INPUT_BYTES = 20 * 1024 * 1024 // 20 MB input limit

export function ImageUploadInput({ value, onChange, onClear }: ImageUploadInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<UploadState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [sizeInfo, setSizeInfo] = useState<{ before: number; after: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  async function processFile(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      setErrorMsg('Only JPG, PNG, WebP, or GIF allowed.')
      setState('error')
      return
    }
    if (file.size > MAX_INPUT_BYTES) {
      setErrorMsg(`File too large (max 20 MB, yours: ${formatBytes(file.size)})`)
      setState('error')
      return
    }

    setState('processing')
    setErrorMsg('')
    setSizeInfo(null)

    try {
      const dataUrl = await optimizeImage(file)
      const after = dataUrlBytes(dataUrl)
      setSizeInfo({ before: file.size, after })
      setState('done')
      onChange(dataUrl)
    } catch (err) {
      console.error(err)
      setErrorMsg('Could not process image.')
      setState('error')
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    // Reset so gleiche Datei nochmal gewählt werden kann
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  function handleClear() {
    setState('idle')
    setSizeInfo(null)
    setErrorMsg('')
    onClear()
  }

  const isProcessing = state === 'processing'

  return (
    <Box>
      {/* Drop Zone – nur zeigen wenn kein Bild gesetzt */}
      {!value && (
        <Box
          onClick={() => !isProcessing && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          sx={{
            border: '2px dashed',
            borderColor: dragging ? 'primary.main' : state === 'error' ? 'error.main' : 'divider',
            borderRadius: 'var(--radius-md, 8px)',
            p: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            cursor: isProcessing ? 'wait' : 'pointer',
            bgcolor: dragging ? 'action.hover' : 'background.paper',
            transition: 'border-color 0.2s, background-color 0.2s',
            '&:hover': { borderColor: isProcessing ? undefined : 'primary.main', bgcolor: isProcessing ? undefined : 'action.hover' },
          }}
        >
          {isProcessing ? (
            <CircularProgress size={28} />
          ) : (
            <CloudUploadIcon sx={{ fontSize: 32, color: 'text.disabled' }} />
          )}
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {isProcessing
              ? 'Optimizing image…'
              : 'Drop image here or click to select'}
          </Typography>
          <Typography variant="caption" color="text.disabled">
            JPG · PNG · WebP · GIF · max 20 MB → resized to 1280×960 WebP
          </Typography>
        </Box>
      )}

      {/* Verstecktes File-Input */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />

      {/* Fehler-Meldung */}
      {state === 'error' && (
        <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
          {errorMsg}
        </Typography>
      )}

      {/* Vorschau nach Upload */}
      {value && (
        <Box sx={{ position: 'relative', borderRadius: 'var(--radius-md, 8px)', overflow: 'hidden', mt: 0 }}>
          <img
            src={value}
            alt="Vorschau"
            style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }}
          />

          {/* Size-Badge */}
          {sizeInfo && (
            <Box
              sx={{
                position: 'absolute', bottom: 6, left: 8,
                bgcolor: 'rgba(0,0,0,0.6)', borderRadius: 1,
                px: 0.75, py: 0.25,
                display: 'flex', alignItems: 'center', gap: 0.5,
              }}
            >
              <CheckCircleIcon sx={{ fontSize: 13, color: '#4caf50' }} />
              <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.7rem' }}>
                {formatBytes(sizeInfo.before)} → {formatBytes(sizeInfo.after)}
              </Typography>
            </Box>
          )}

          {/* Delete-Button */}
          <IconButton
            size="small"
            onClick={handleClear}
            sx={{
              position: 'absolute', top: 4, right: 4,
              bgcolor: 'rgba(0,0,0,0.5)', color: '#fff',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {/* Nochmal auswählen nach Upload */}
      {value && (
        <Box
          component="button"
          onClick={() => inputRef.current?.click()}
          sx={{ mt: 0.5, cursor: 'pointer', border: 'none', bgcolor: 'transparent', color: 'primary.main', fontSize: '0.8rem', p: 0 }}
        >
          ↺ Choose a different image
        </Box>
      )}
    </Box>
  )
}
