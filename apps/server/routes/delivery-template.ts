import { Router } from 'express'
import { PrismaClient } from '@prisma/client'

export function createDeliveryTemplateRouter(prisma: PrismaClient) {
  const router = Router()

  // GET /api/delivery-templates/company/:companyId - Get all templates for a company
  router.get('/company/:companyId', async (req, res) => {
    try {
      const { companyId } = req.params
      const templates = await prisma.deliveryTemplate.findMany({
        where: { companyId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      })
      res.json({ templates })
    } catch (error) {
      console.error('Failed to fetch delivery templates:', error)
      res.status(500).json({ error: 'Failed to fetch delivery templates' })
    }
  })

  // GET /api/delivery-templates/by-pubkey/:pubkey - Get all templates for a company by owner pubkey
  router.get('/by-pubkey/:pubkey', async (req, res) => {
    try {
      const { pubkey } = req.params
      const company = await prisma.company.findUnique({
        where: { ownerPubkey: pubkey },
        select: { id: true },
      })
      if (!company) {
        return res.json({ templates: [] })
      }
      const templates = await prisma.deliveryTemplate.findMany({
        where: { companyId: company.id },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      })
      res.json({ templates })
    } catch (error) {
      console.error('Failed to fetch delivery templates by pubkey:', error)
      res.status(500).json({ error: 'Failed to fetch delivery templates' })
    }
  })

  // GET /api/delivery-templates/:id - Get single template
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params
      const template = await prisma.deliveryTemplate.findUnique({
        where: { id },
      })
      if (!template) {
        return res.status(404).json({ error: 'Delivery template not found' })
      }
      res.json({ template })
    } catch (error) {
      console.error('Failed to fetch delivery template:', error)
      res.status(500).json({ error: 'Failed to fetch delivery template' })
    }
  })

  // POST /api/delivery-templates - Create new template
  router.post('/', async (req, res) => {
    try {
      const { companyId, name, deliveryTimeDays, deliveryCostSats, isDefault } = req.body

      if (!companyId || !name || deliveryTimeDays === undefined || deliveryCostSats === undefined) {
        return res.status(400).json({ error: 'Missing required fields: companyId, name, deliveryTimeDays, deliveryCostSats' })
      }

      if (isDefault) {
        await prisma.deliveryTemplate.updateMany({
          where: { companyId, isDefault: true },
          data: { isDefault: false },
        })
      }

      const template = await prisma.deliveryTemplate.create({
        data: {
          companyId,
          name,
          deliveryTimeDays,
          deliveryCostSats,
          isDefault: isDefault || false,
        },
      })

      res.json({ success: true, template })
    } catch (error) {
      console.error('Failed to create delivery template:', error)
      res.status(500).json({ error: 'Failed to create delivery template' })
    }
  })

  // PATCH /api/delivery-templates/:id - Update template
  router.patch('/:id', async (req, res) => {
    try {
      const { id } = req.params
      const { name, deliveryTimeDays, deliveryCostSats, isDefault } = req.body

      const existing = await prisma.deliveryTemplate.findUnique({ where: { id } })
      if (!existing) {
        return res.status(404).json({ error: 'Delivery template not found' })
      }

      if (isDefault && !existing.isDefault) {
        await prisma.deliveryTemplate.updateMany({
          where: { companyId: existing.companyId, isDefault: true },
          data: { isDefault: false },
        })
      }

      const template = await prisma.deliveryTemplate.update({
        where: { id },
        data: {
          name,
          deliveryTimeDays,
          deliveryCostSats,
          isDefault,
        },
      })

      res.json({ success: true, template })
    } catch (error) {
      console.error('Failed to update delivery template:', error)
      res.status(500).json({ error: 'Failed to update delivery template' })
    }
  })

  // DELETE /api/delivery-templates/:id - Delete template
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params
      await prisma.deliveryTemplate.delete({ where: { id } })
      res.json({ success: true })
    } catch (error) {
      console.error('Failed to delete delivery template:', error)
      res.status(500).json({ error: 'Failed to delete delivery template' })
    }
  })

  return router
}