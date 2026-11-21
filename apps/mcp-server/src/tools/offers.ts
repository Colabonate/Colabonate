import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callApi } from './api.js';
import { FULL_GATE, type ToolGate } from './gate.js';
import { resolveImageRefs } from './images.js';

export interface ToolContext {
  pubkey: string;
  token: string;
  identityLevel: number;
}

export type ImageAwareContext = ToolContext & { pendingImages?: string[] };

const searchOffersSchema = z.object({
  query: z.string().optional(),
  category: z.string().optional(),
  offerType: z.enum(['SERVICE', 'PRODUCT']).optional(),
});

const getOfferSchema = z.object({
  id: z.string(),
});

const createOfferSchema = z.object({
  title: z.string(),
  priceSats: z.number(),
  offerType: z.enum(['SERVICE', 'PRODUCT']),
  description: z.string().optional().describe('Detailed description of the offer or service'),
  category: z.string().optional(),
  categoryCode: z.string().optional().describe('StandardCategory slug, e.g. services/programming, goods/electronics'),
  deliveryTimeDays: z.number().optional(),
  status: z.enum(['DRAFT', 'ACTIVE']).optional(),
  images: z.array(z.string()).optional().describe('Array of image references from get_pending_images (e.g. "pending:0"), or HTTPS URLs'),
});

const updateOfferSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  priceSats: z.number().optional(),
  description: z.string().optional().describe('Detailed description of the offer or service'),
  offerType: z.enum(['SERVICE', 'PRODUCT']).optional(),
  category: z.string().optional(),
  categoryCode: z.string().optional().describe('StandardCategory slug, e.g. services/programming, goods/electronics'),
  deliveryTimeDays: z.number().optional(),
  deliveryCostSats: z.number().optional(),
  deliveryNotes: z.string().optional(),
  location: z.string().optional(),
  status: z.string().optional().describe('Set to "ACTIVE" to publish, "ARCHIVED" to unpublish'),
  images: z.array(z.string()).optional().describe('Array of image references from get_pending_images (e.g. "pending:0"), or HTTPS URLs. Replaces all existing images.'),
});

const deleteOfferSchema = z.object({
  id: z.string(),
});

// F12: /api/search returns full re-hydrated offers (relations, timestamps,
// wallet-adjacent fields). The model only needs the card-relevant fields, so
// `search_offers` projects each hit down — smaller tool payload, fewer tokens
// spent on data the app renders itself.
interface RawSearchOffer {
  id?: string;
  title?: string;
  priceSats?: number;
  offerType?: string;
  categoryCode?: string;
  status?: string;
  description?: string;
  images?: string[];
  imageThumbs?: string[] | null;
  source?: string;
  priceAmount?: string | null;
  priceCurrency?: string | null;
  originUrl?: string | null;
}

function projectOffer(offer: RawSearchOffer, includeDescription: boolean): Record<string, unknown> {
  const projected: Record<string, unknown> = {
    id: offer.id,
    title: offer.title,
    priceSats: offer.priceSats,
    offerType: offer.offerType,
    category: offer.categoryCode,
    status: offer.status,
  };
  if (includeDescription && offer.description) projected.description = offer.description;
  if (Array.isArray(offer.imageThumbs) && offer.imageThumbs.length > 0) projected.imageThumbs = offer.imageThumbs;
  if (Array.isArray(offer.images) && offer.images.length > 0) projected.images = offer.images;
  if (typeof offer.source === 'string') projected.source = offer.source;
  if (typeof offer.priceCurrency === 'string' && offer.priceCurrency) {
    projected.priceAmount = offer.priceAmount ?? null;
    projected.priceCurrency = offer.priceCurrency;
  }
  if (typeof offer.originUrl === 'string' && offer.originUrl) projected.originUrl = offer.originUrl;
  // REMOTE offers come from other Nostr marketplaces and cannot be ordered here.
  if (offer.source === 'REMOTE') projected.orderableOnColabonate = false;
  return projected;
}

export function registerOfferTools(server: McpServer, ctx: ImageAwareContext, gate: ToolGate = FULL_GATE) {
  server.registerTool(
    'search_offers',
    {
      description: 'Search for marketplace offers with optional filters',
      inputSchema: searchOffersSchema,
    },
    async ({ query, category, offerType }) => {
      const params = new URLSearchParams({ first: '20' });
      if (query) params.set('q', query);
      if (category) params.set('categoryCode', category);
      if (offerType) params.set('offerType', offerType);

      const data = await callApi<{ hits?: RawSearchOffer[] }>(`/api/search?${params}`);
      const hits = Array.isArray(data.hits) ? data.hits : [];
      const single = hits.length === 1;
      const offers = hits.map((offer) => {
        const projected = projectOffer(offer, single);
        if (query) projected.sourceQuery = query;
        return projected;
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ offers }) }] };
    }
  );

  if (!gate.isGuest)
    server.registerTool(
      'search_my_offers',
      {
        description: 'Search for the current user\'s own offers',
        inputSchema: z.object({
          category: z.string().optional(),
          offerType: z.enum(['SERVICE', 'PRODUCT']).optional(),
        }),
      },
      async ({ category, offerType }) => {
        const params = new URLSearchParams({ creatorPubkey: ctx.pubkey });
        if (category) params.set('category', category);
        if (offerType) params.set('offerType', offerType);
        const data = await callApi<{ offers: unknown[] }>(`/api/offers?${params}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  server.registerTool(
    'get_offer',
    {
      description: 'Get a single offer by ID',
      inputSchema: getOfferSchema,
    },
    async ({ id }) => {
      const data = await callApi<{ offer: unknown }>(`/api/offers/${id}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );

  if (gate.canWrite('offers'))
    server.registerTool(
      'create_offer',
      {
        description: 'Create a new marketplace offer. By default creates a DRAFT. Set status to "ACTIVE" to publish immediately and make the offer visible on the marketplace. Use ACTIVE when the user wants to publish/list/go live right away.',
        inputSchema: createOfferSchema,
      },
      async (args) => {
        const data = await callApi<{ offer: unknown }>('/api/offers', {
          method: 'POST',
          body: JSON.stringify({ ...args, images: resolveImageRefs(args.images, ctx.pendingImages ?? []) }),
          token: ctx.token,
        });
        const offer = data.offer as Record<string, unknown> | undefined;
        const offerId = offer?.id;
        return { content: [{ type: 'text' as const, text: JSON.stringify({ offer: data.offer, id: offerId, created: true }) }] };
      }
    );

  if (gate.canWrite('offers'))
    server.registerTool(
      'update_offer',
      {
        description: 'Update an existing offer. Use status "ACTIVE" to publish a draft, "ARCHIVED" to unpublish.',
        inputSchema: updateOfferSchema,
      },
      async ({ id, ...updates }) => {
        const data = await callApi<{ offer: unknown }>(`/api/offers/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...updates, images: resolveImageRefs(updates.images, ctx.pendingImages ?? []) }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ offer: data.offer, changed: Object.keys(updates) }) }] };
      }
    );

  if (gate.canWrite('offers'))
    server.registerTool(
      'delete_offer',
      {
        description: 'Delete an offer',
        inputSchema: deleteOfferSchema,
      },
      async ({ id }) => {
        await callApi(`/api/offers/${id}`, { method: 'DELETE', token: ctx.token });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true, id }) }] };
      }
    );
}
