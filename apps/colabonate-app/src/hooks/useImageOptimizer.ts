/**
 * useImageOptimizer
 *
 * Resizes and compresses an image file in the browser using Canvas.
 * Target: max 1280×960px, WebP quality 88% (ADR-295 quality uplift —
 * former 600×400/85% was too soft for hero cards and detail galleries
 * on 2× displays). Browsers that don't support canvas.toDataURL('image/webp')
 * (iOS Safari < 14, very old Chromium) silently fall back to JPEG; the
 * canvas test below detects the lie and downgrades automatically so the
 * pipeline never produces broken PNG-from-WebP-fail data-URLs.
 *
 * Alpha is preserved end-to-end (no white flatten) so transparent PNGs
 * stay transparent in WebP.
 *
 * Returns a data-URL that can be stored directly in offer.images[].
 */

export interface OptimizeOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  mimeType?: string
}

const DEFAULTS: Required<OptimizeOptions> = {
  maxWidth: 1280,
  maxHeight: 960,
  quality: 0.88,
  mimeType: 'image/webp',
}

/**
 * Browser feature-detect for canvas.toDataURL('image/webp').
 * Cached on first call. iOS Safari < 14 and very old Chromium return
 * 'image/png' silently when asked for WebP; we treat that as unsupported.
 */
let webpCanvasCache: boolean | null = null
function supportsCanvasWebP(): boolean {
  if (webpCanvasCache !== null) return webpCanvasCache
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const url = c.toDataURL('image/webp')
    webpCanvasCache = url.startsWith('data:image/webp')
  } catch {
    webpCanvasCache = false
  }
  return webpCanvasCache
}

export function optimizeImage(
  file: File,
  options: OptimizeOptions = {}
): Promise<string> {
  const requested = { ...DEFAULTS, ...options }
  const mimeType = requested.mimeType === 'image/webp' && !supportsCanvasWebP()
    ? 'image/jpeg'
    : requested.mimeType
  const { maxWidth, maxHeight, quality } = requested

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      const img = new Image()

      img.onload = () => {
        let { width, height } = img

        const scaleW = maxWidth / width
        const scaleH = maxHeight / height
        const scale = Math.min(scaleW, scaleH, 1)

        width = Math.round(width * scale)
        height = Math.round(height * scale)

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas context not available'))
          return
        }

        ctx.drawImage(img, 0, 0, width, height)

        resolve(canvas.toDataURL(mimeType, quality))
      }

      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = dataUrl
    }

    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Approximate byte size of a data-URL */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? ''
  return Math.round((base64.length * 3) / 4)
}
