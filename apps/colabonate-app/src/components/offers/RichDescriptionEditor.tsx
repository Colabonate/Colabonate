import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Button, CircularProgress, FormHelperText, IconButton, InputAdornment, TextField, Tooltip, Typography } from '@mui/material'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import Looks3OutlinedIcon from '@mui/icons-material/Looks3Outlined'
import Looks4OutlinedIcon from '@mui/icons-material/Looks4Outlined'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import InsertLinkIcon from '@mui/icons-material/InsertLink'
import LinkOffOutlinedIcon from '@mui/icons-material/LinkOffOutlined'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { optimizeImage } from '../../hooks/useImageOptimizer'
import { RichText, richTextToPlainText, videoEmbedSrc } from './RichText'
import { BuyAiCreditsDialog } from '../ai-assistant/BuyAiCreditsDialog'

export interface RichDescriptionEditorAiContext {
  title: string
  offerType: string
  category?: string
}

export interface RichDescriptionEditorProps {
  value: string
  onChange: (html: string) => void
  label?: string
  error?: boolean
  helperText?: string
  required?: boolean
  disabled?: boolean
  aiContext: RichDescriptionEditorAiContext
  /** Stretch the editable area vertically to fill the parent column
   *  (e.g. a grid cell next to a taller sibling) instead of using the
   *  fixed minHeight/maxHeight range. */
  fillHeight?: boolean
}

// ADR-295 D4: one-shot client against the existing /ai/chat SSE endpoint.
// Deliberately NOT useAIChat — that hook persists assistant chat sessions,
// an inline field assist must not pollute them.
const AI_CHAT_URL = '/ai/chat'

// ADR-295 D6 media: same accepted types / input ceiling as the offer-photo
// pipeline (ImageUploadInput); uploads run through the shared optimizer
// (1280×960 JPEG 88% — ADR-295 quality uplift) and are stored as data-URLs —
// the project-standard image storage pattern. Output cap aligned with the
// /api/upload/image limit (1.5 MB data-URL string).
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_OUTPUT_BYTES = 1536 * 1024

// Image node with a persisted width attribute for the size presets.
const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: '100%',
        parseHTML: (el) => el.getAttribute('width') ?? '100%',
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
    }
  },
})

const IMAGE_WIDTH_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'S', value: '25%' },
  { label: 'M', value: '50%' },
  { label: 'L', value: '75%' },
  { label: 'Full', value: '100%' },
]

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/)
  return match ? match[1] : trimmed
}

function buildAiMessage(context: RichDescriptionEditorAiContext, instruction: string, currentDescription: string): string {
  const currentPlain = richTextToPlainText(currentDescription).trim()
  const lines = [
    'You are writing the description for an offer on the Colabonate marketplace (Lightning-escrow sats marketplace).',
    `Offer title: "${context.title.trim() || '(not set yet)'}"`,
    `Offer type: ${context.offerType}`,
  ]
  if (context.category) lines.push(`Category: ${context.category}`)
  lines.push(
    '',
    currentPlain
      ? `Current description (revise it according to the instructions below):\n${currentPlain}`
      : 'Current description: (empty — write a new one)',
    '',
    `Seller instructions: ${instruction.trim()}`,
    '',
    'Respond with the description ONLY as HTML, using exclusively these tags: <p>, <strong>, <em>, <ul>, <ol>, <li>, <h3>, <h4>, <a href="...">.',
    'No markdown, no code fences, no explanation — the response is inserted into a rich text editor as-is.',
  )
  return lines.join('\n')
}

export function RichDescriptionEditor({
  value,
  onChange,
  label = 'Description',
  error = false,
  helperText,
  required = false,
  disabled = false,
  aiContext,
  fillHeight = false,
}: RichDescriptionEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
        // Keep the schema inside the ADR-295 D2 tag allowlist — anything not
        // offered here is dropped or converted on paste.
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      ResizableImage.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: value || '<p></p>',
    editable: !disabled,
    onUpdate: ({ editor: e }) => {
      onChange(e.isEmpty ? '' : e.getHTML())
    },
  })

  // External value changes (prefill, product import) sync into the editor
  // without disturbing typing: only setContent when the normalized values
  // actually differ.
  useEffect(() => {
    // isDestroyed: a destroyed editor has a null schema — getHTML() would
    // throw "can't access property 'cached', schema is null" (e.g. when the
    // effect re-runs with a stale instance after unmount/remount).
    if (!editor || editor.isDestroyed) return
    const current = editor.isEmpty ? '' : editor.getHTML()
    if (value !== current) {
      editor.commands.setContent(value || '<p></p>', { emitUpdate: false })
    }
  }, [value, editor])

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!disabled)
  }, [editor, disabled])

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            h3: e.isActive('heading', { level: 3 }),
            h4: e.isActive('heading', { level: 4 }),
            bulletList: e.isActive('bulletList'),
            orderedList: e.isActive('orderedList'),
            link: e.isActive('link'),
            image: e.isActive('image'),
            imageWidth: (e.getAttributes('image').width as string | undefined) ?? '100%',
          }
        : { bold: false, italic: false, h3: false, h4: false, bulletList: false, orderedList: false, link: false, image: false, imageWidth: '100%' },
  })

  // ── Link input row ──────────────────────────────────────────────────────
  const [linkInputOpen, setLinkInputOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  const applyLink = useCallback(() => {
    if (!editor) return
    const url = linkUrl.trim()
    if (url) {
      const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
      editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run()
    }
    setLinkInputOpen(false)
    setLinkUrl('')
  }, [editor, linkUrl])

  // ── Media insert: image + video (ADR-295 D6) ───────────────────────────
  const [mediaInput, setMediaInput] = useState<'image' | 'video' | null>(null)
  const [mediaUrl, setMediaUrl] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [mediaUploading, setMediaUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const insertImage = useCallback((src: string) => {
    editor
      ?.chain()
      .focus()
      .setImage({ src, alt: '' })
      .updateAttributes('image', { width: '50%' })
      .run()
    setMediaInput(null)
    setMediaUrl('')
    setMediaError('')
  }, [editor])

  const applyImageUrl = useCallback(() => {
    const url = mediaUrl.trim()
    if (!url) return
    if (!/^https:\/\/|data:image\//i.test(url)) {
      setMediaError('Image URL must start with https://')
      return
    }
    insertImage(url)
  }, [mediaUrl, insertImage])

  const handleImageFile = useCallback(async (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setMediaError('Only JPG, PNG, WebP, or GIF allowed.')
      return
    }
    if (file.size > MAX_INPUT_BYTES) {
      setMediaError('File too large (max 20 MB).')
      return
    }
    setMediaUploading(true)
    setMediaError('')
    try {
      const dataUrl = await optimizeImage(file)
      if (dataUrl.length > MAX_OUTPUT_BYTES) {
        setMediaError('Image still too large after optimization (max 1.5 MB) — pick a smaller one.')
        return
      }
      insertImage(dataUrl)
    } catch {
      setMediaError('Could not process image.')
    } finally {
      setMediaUploading(false)
    }
  }, [insertImage])

  const applyVideoUrl = useCallback(() => {
    if (!editor) return
    const url = mediaUrl.trim()
    if (!url) return
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    if (!videoEmbedSrc(normalized)) {
      setMediaError('Only YouTube and Vimeo video links are supported.')
      return
    }
    const { from, to, empty } = editor.state.selection
    if (empty) {
      // Standalone video link paragraph (render surfaces turn it into an embed)
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'paragraph',
          content: [{ type: 'text', text: normalized, marks: [{ type: 'link', attrs: { href: normalized } }] }],
        })
        .run()
    } else {
      editor.chain().focus().setTextSelection({ from, to }).setLink({ href: normalized }).run()
    }
    setMediaInput(null)
    setMediaUrl('')
    setMediaError('')
  }, [editor, mediaUrl])

  // ── AI Assist (ADR-295 D4) ──────────────────────────────────────────────
  const [aiOpen, setAiOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiResult, setAiResult] = useState('')
  const [aiError, setAiError] = useState('')
  // ADR-384/F1 follow-up: a no-credits user (AI_CREDITS_EXHAUSTED from
  // /ai/chat's credit reservation) gets the canonical buy dialog right in
  // the error row instead of a dead-end message.
  const [aiCreditsExhausted, setAiCreditsExhausted] = useState(false)
  const [buyCreditsOpen, setBuyCreditsOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const generate = useCallback(async () => {
    if (aiStreaming || !instruction.trim()) return
    const token = localStorage.getItem('authToken')
    if (!token) {
      setAiError('Please log in to use the AI assistant.')
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setAiStreaming(true)
    setAiError('')
    setAiResult('')
    setAiCreditsExhausted(false)
    try {
      const response = await fetch(AI_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: buildAiMessage(aiContext, instruction, value),
          token,
          history: [],
          model: localStorage.getItem('aiModel') || undefined,
          provider: localStorage.getItem('aiProvider') || undefined,
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        setAiError(`AI request failed (${response.status}).`)
        return
      }
      const reader = response.body?.getReader()
      if (!reader) {
        setAiError('No stream available.')
        return
      }
      const decoder = new TextDecoder()
      let buffer = ''
      let received = ''
      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (!data) continue
          try {
            const event = JSON.parse(data) as { type: string; delta?: string; message?: string; code?: string }
            if (event.type === 'text-delta' && event.delta) {
              received += event.delta
              setAiResult(stripCodeFence(received))
            } else if (event.type === 'error') {
              // Same code contract useAIChat maps (friendlyErrorMessage):
              // AI_CREDITS_EXHAUSTED means the user can fix it by buying.
              if (event.code === 'AI_CREDITS_EXHAUSTED') {
                setAiCreditsExhausted(true)
                setAiError('You are out of Colabonate AI credits. Buy a pack below, or connect your own provider key.')
              } else {
                setAiError(event.message ?? 'AI assistant error.')
              }
              return
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
      if (!received.trim()) setAiError('The AI assistant returned an empty response.')
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setAiError(`Connection error: ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      setAiStreaming(false)
    }
  }, [aiContext, aiStreaming, instruction, value])

  const cancelAi = useCallback(() => {
    abortRef.current?.abort()
    setAiStreaming(false)
  }, [])

  const insertAiResult = useCallback(() => {
    if (!editor || !aiResult) return
    const html = stripCodeFence(aiResult)
    editor.commands.setContent(html, { emitUpdate: true })
    setAiOpen(false)
    setInstruction('')
    setAiResult('')
    setAiError('')
    setAiCreditsExhausted(false)
  }, [editor, aiResult])

  const discardAiResult = useCallback(() => {
    abortRef.current?.abort()
    setAiOpen(false)
    setInstruction('')
    setAiResult('')
    setAiError('')
    setAiCreditsExhausted(false)
  }, [])

  const toolbarButton = (
    title: string,
    icon: ReactNode,
    active: boolean,
    onClick: () => void,
    keyId: string,
  ) => (
    <Tooltip title={title} key={keyId}>
      <span>
        <IconButton
          size="small"
          onClick={onClick}
          disabled={!editor || disabled}
          sx={{
            color: active ? 'var(--color-primary-50)' : 'var(--theme-text-muted)',
            border: `1px solid ${active ? 'var(--color-primary-40)' : 'transparent'}`,
            borderRadius: 'var(--radius-sm, 6px)',
            '&:hover': { color: 'var(--theme-text)' },
          }}
          aria-label={title}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  )

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        ...(fillHeight && {
          // Fill the parent column: frame grows with it, the editable area
          // absorbs the remaining height (manual vertical resize still works).
          height: '100%',
          '& .rich-description-editor': {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          },
          '& .rich-description-editor__area': {
            flex: 1,
            minHeight: 148,
            maxHeight: 'none',
          },
        }),
      }}
    >
      {/* Label row + AI Assistant toggle (ADR-295 D4) */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5, flexWrap: 'wrap', gap: 1 }}>
        <Typography
          component="label"
          variant="body2"
          sx={{ fontWeight: 600, color: error ? 'var(--color-status-error, #d32f2f)' : 'var(--theme-text)' }}
        >
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </Typography>
        <Tooltip title={aiOpen ? 'Close AI assistant' : 'Generate description with AI'}>
          <span>
            <Button
              size="small"
              startIcon={<AutoAwesomeIcon />}
              onClick={() => setAiOpen(prev => !prev)}
              disabled={disabled}
              sx={{
                textTransform: 'none',
                color: aiOpen ? 'var(--color-primary-60)' : 'var(--theme-text-muted)',
                borderColor: 'var(--theme-border)',
                '&:hover': { color: 'var(--color-primary-50)' },
              }}
              variant="text"
            >
              AI Assistant
            </Button>
          </span>
        </Tooltip>
      </Box>

      {/* Editor frame: toolbar + resizable content area */}
      <Box
        className="rich-description-editor"
        sx={{
          border: `1px solid ${error ? 'var(--color-status-error, #d32f2f)' : 'var(--theme-border)'}`,
          borderRadius: 'var(--radius-md, 8px)',
          background: 'var(--theme-surface)',
          transition: 'border-color 0.15s ease',
          '&:focus-within': {
            borderColor: error ? 'var(--color-status-error, #d32f2f)' : 'var(--color-primary-40)',
          },
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.25,
            px: 1,
            py: 0.5,
            borderBottom: '1px solid var(--theme-border)',
          }}
          role="toolbar"
          aria-label="Text formatting"
        >
          {toolbarButton('Bold', <FormatBoldIcon fontSize="small" />, toolbarState.bold, () => editor?.chain().focus().toggleBold().run(), 'bold')}
          {toolbarButton('Italic', <FormatItalicIcon fontSize="small" />, toolbarState.italic, () => editor?.chain().focus().toggleItalic().run(), 'italic')}
          {toolbarButton('Heading 3', <Looks3OutlinedIcon fontSize="small" />, toolbarState.h3, () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), 'h3')}
          {toolbarButton('Heading 4', <Looks4OutlinedIcon fontSize="small" />, toolbarState.h4, () => editor?.chain().focus().toggleHeading({ level: 4 }).run(), 'h4')}
          {toolbarButton('Bullet list', <FormatListBulletedIcon fontSize="small" />, toolbarState.bulletList, () => editor?.chain().focus().toggleBulletList().run(), 'ul')}
          {toolbarButton('Numbered list', <FormatListNumberedIcon fontSize="small" />, toolbarState.orderedList, () => editor?.chain().focus().toggleOrderedList().run(), 'ol')}
          {toolbarState.link
            ? toolbarButton('Remove link', <LinkOffOutlinedIcon fontSize="small" />, true, () => editor?.chain().focus().unsetLink().run(), 'unlink')
            : toolbarButton('Add link', <InsertLinkIcon fontSize="small" />, false, () => {
                setLinkUrl(editor?.getAttributes('link').href ?? '')
                setLinkInputOpen(true)
              }, 'link')}
          {toolbarButton('Insert image', <ImageOutlinedIcon fontSize="small" />, mediaInput === 'image', () => {
            setMediaUrl('')
            setMediaError('')
            setMediaInput(mediaInput === 'image' ? null : 'image')
          }, 'image')}
          {toolbarButton('Insert video link (YouTube / Vimeo)', <PlayCircleOutlineIcon fontSize="small" />, mediaInput === 'video', () => {
            setMediaUrl('')
            setMediaError('')
            setMediaInput(mediaInput === 'video' ? null : 'video')
          }, 'video')}
        </Box>

        {/* Image width presets — visible while an image is selected */}
        {toolbarState.image && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5, borderBottom: '1px solid var(--theme-border)', flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', mr: 0.5 }}>
              Image width
            </Typography>
            {IMAGE_WIDTH_PRESETS.map(preset => (
              <Button
                key={preset.value}
                size="small"
                variant={toolbarState.imageWidth === preset.value ? 'contained' : 'text'}
                onClick={() => editor?.chain().focus().updateAttributes('image', { width: preset.value }).run()}
                sx={{ minWidth: 32, px: 1, py: 0.25, fontSize: '0.7rem', textTransform: 'none' }}
              >
                {preset.label}
              </Button>
            ))}
          </Box>
        )}

        {mediaInput && (
          <Box sx={{ display: 'flex', gap: 1, px: 1.5, py: 1, borderBottom: '1px solid var(--theme-border)', alignItems: 'center', flexWrap: 'wrap' }}>
            {mediaInput === 'image' ? (
              <>
                <TextField
                  size="small"
                  label="Image URL (https)"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyImageUrl()
                    if (e.key === 'Escape') setMediaInput(null)
                  }}
                  autoFocus
                  fullWidth
                  placeholder="https://example.com/photo.jpg"
                  disabled={mediaUploading}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(',')}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleImageFile(file)
                    e.target.value = ''
                  }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={mediaUploading}
                  startIcon={mediaUploading ? <CircularProgress size={14} /> : undefined}
                >
                  {mediaUploading ? 'Optimizing…' : 'Upload'}
                </Button>
                <Button size="small" onClick={applyImageUrl} variant="contained" disabled={!mediaUrl.trim() || mediaUploading}>
                  Insert URL
                </Button>
              </>
            ) : (
              <>
                <TextField
                  size="small"
                  label="Video URL (YouTube / Vimeo)"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyVideoUrl()
                    if (e.key === 'Escape') setMediaInput(null)
                  }}
                  autoFocus
                  fullWidth
                  placeholder="https://www.youtube.com/watch?v=…"
                />
                <Button size="small" onClick={applyVideoUrl} variant="contained" disabled={!mediaUrl.trim()}>
                  Insert
                </Button>
              </>
            )}
            <Button size="small" color="inherit" onClick={() => { setMediaInput(null); setMediaUrl(''); setMediaError('') }}>
              Cancel
            </Button>
            {mediaError && (
              <Typography variant="caption" sx={{ color: 'var(--color-status-error, #d32f2f)', width: '100%' }} role="alert">
                {mediaError}
              </Typography>
            )}
          </Box>
        )}

        {linkInputOpen && (
          <Box sx={{ display: 'flex', gap: 1, px: 1.5, py: 1, borderBottom: '1px solid var(--theme-border)', alignItems: 'center' }}>
            <TextField
              size="small"
              label="Link URL"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyLink()
                if (e.key === 'Escape') {
                  setLinkInputOpen(false)
                  setLinkUrl('')
                }
              }}
              autoFocus
              fullWidth
              placeholder="https://…"
            />
            <Button size="small" onClick={applyLink} variant="outlined">Apply</Button>
            <Button size="small" onClick={() => { setLinkInputOpen(false); setLinkUrl('') }} color="inherit">Cancel</Button>
          </Box>
        )}

        <Box
          className="rich-description-editor__area"
          sx={{
            resize: 'vertical',
            overflowY: 'auto',
            minHeight: 148,
            maxHeight: 640,
            px: 1.5,
            py: 1.25,
            cursor: 'text',
          }}
          onClick={() => editor?.commands.focus()}
        >
          {editor ? (
            <EditorContent editor={editor} />
          ) : (
            <Box sx={{ minHeight: 120 }} />
          )}
        </Box>
      </Box>

      <FormHelperText error={error} sx={{ mx: 1.75, mt: 0.5 }}>
        {helperText ?? ' '}
      </FormHelperText>

      {/* AI Assist panel (ADR-295 D4) */}
      {aiOpen && (
        <Box
          sx={{
            mt: 1.5,
            p: 2,
            borderRadius: 'var(--radius-md, 8px)',
            border: '1px dashed var(--color-primary-30)',
            background: 'var(--color-primary-10, transparent)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
            Describe what the AI should write — the offer title
            {aiContext.title.trim() ? ` ("${aiContext.title.trim()}")` : ''} is used as context.
          </Typography>
          <TextField
            size="small"
            label="AI instructions"
            placeholder="e.g. Emphasize fast turnaround and 24h support, keep it under 120 words"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={aiStreaming}
            fullWidth
            multiline
            minRows={2}
            maxRows={4}
            slotProps={{
              input: {
                endAdornment: aiStreaming ? (
                  <InputAdornment position="end">
                    <CircularProgress size={18} />
                  </InputAdornment>
                ) : undefined,
              },
            }}
          />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {aiStreaming ? (
              <Button size="small" startIcon={<CancelOutlinedIcon />} onClick={cancelAi} variant="outlined" color="inherit">
                Cancel
              </Button>
            ) : (
              <Button
                size="small"
                startIcon={<AutoAwesomeIcon />}
                onClick={generate}
                variant="contained"
                disabled={!instruction.trim()}
              >
                Generate
              </Button>
            )}
            {aiResult.trim() && !aiStreaming && (
              <>
                <Button size="small" onClick={insertAiResult} variant="outlined">
                  Insert (replaces current text)
                </Button>
                <Button size="small" onClick={discardAiResult} color="inherit">
                  Discard
                </Button>
              </>
            )}
          </Box>
          {aiError && (
            <Typography variant="body2" sx={{ color: 'var(--color-status-error, #d32f2f)' }} role="alert">
              {aiError}
            </Typography>
          )}
          {aiCreditsExhausted && (
            <>
              <Button
                size="small"
                startIcon={<AutoAwesomeIcon />}
                variant="contained"
                onClick={() => setBuyCreditsOpen(true)}
              >
                Buy AI credits
              </Button>
              <BuyAiCreditsDialog
                open={buyCreditsOpen}
                onClose={() => {
                  setBuyCreditsOpen(false)
                  // Whether they bought or dismissed: clear the dead-end so
                  // Generate is immediately usable again (a purchase sets
                  // aiProvider=platform, the next request reserves fresh
                  // credits; a dismiss simply re-errors if still empty).
                  setAiCreditsExhausted(false)
                  setAiError('')
                }}
              />
            </>
          )}
          {(aiResult || aiStreaming) && (
            <Box>
              <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                AI preview
              </Typography>
              <Box sx={{ mt: 0.5, p: 1.5, borderRadius: 'var(--radius-sm, 6px)', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
                <RichText value={aiResult} />
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}
