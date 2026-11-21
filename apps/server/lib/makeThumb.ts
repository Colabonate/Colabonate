import sharp from 'sharp'

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/s

export async function makeThumb(dataUrl: string): Promise<string | null> {
  const match = dataUrl.match(DATA_URL_RE)
  if (!match) return null  // plain URL (not a data-URL) — skip, already small
  const input = Buffer.from(match[2], 'base64')
  const output = await sharp(input)
    .resize(160, 120, { fit: 'cover', position: 'centre' })
    .webp({ quality: 60 })
    .toBuffer()
  return `data:image/webp;base64,${output.toString('base64')}`
}

export async function makeThumbsFromImages(images: unknown): Promise<string[] | null> {
  if (!Array.isArray(images) || images.length === 0) return null
  const results = await Promise.all(
    (images as unknown[]).map(img => {
      if (typeof img !== 'string') return Promise.resolve(null)
      // makeThumb() returns null for a plain (non-data-URL) image — already
      // small, nothing to resize. Pass the URL through unchanged instead of
      // dropping it: slim/browse endpoints (ADR-194, ADR-376) select only
      // `imageThumbs`, never the raw `images` column, so any entry filtered
      // out here would be permanently invisible in those views.
      return makeThumb(img).catch(() => null).then(thumb => thumb ?? img)
    })
  )
  const thumbs = results.filter((t): t is string => t !== null)
  return thumbs.length > 0 ? thumbs : null
}
