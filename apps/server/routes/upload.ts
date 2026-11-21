import { Router, type Request, type Response } from 'express'

export function createUploadRouter() {
  const router = Router()

  // POST /api/upload/image - Upload and optimize image
  router.post('/image', async (req, res) => {
    try {
      const { image } = req.body

      if (!image || typeof image !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid image data' })
      }

      // Validate it's a data URL
      if (!image.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Invalid image format. Must be a data URL.' })
      }

      // Check size (max 1.5 MB data-URL string ≈ ~1.1 MB binary — matches the
      // 1280×960/88% client optimizer output from the ADR-295 quality uplift)
      const MAX_SIZE = 1536 * 1024
      if (image.length > MAX_SIZE) {
        return res.status(400).json({ error: 'Image too large. Maximum 1.5 MB after optimization.' })
      }

      // Return the image as-is (already optimized by browser)
      res.json({ success: true, url: image })
    } catch (error) {
      console.error('Failed to upload image:', error)
      res.status(500).json({ error: 'Failed to upload image' })
    }
  })

  return router
}
