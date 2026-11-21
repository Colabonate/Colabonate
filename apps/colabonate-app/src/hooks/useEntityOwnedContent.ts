// useEntityOwnedContent — the single multi-source fetch behind the unified
// profile list (ADR-367 D8). Every resource a User+Company pair owns is fetched
// in parallel, each source independently `.catch()`-degraded to [] (one failing
// source never blanks the whole list), mapped into one common EntityContentItem
// shape, then concatenated + deduped. Mirrors useCoopExploreData's merge
// precedent (fetchCoopExploreData + per-type mapper + concat + dedupe).

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { apiCall } from '../lib/api'
import { richTextToPlainText } from '../components/offers'
import type { Offer, Catalog } from '../types/api'
import type { AgentTask } from './useAgentTaskQueries'
import type { CoopItem } from '../routes/coop/coop-cards'
import { coopToCoopItem, offerToCoopItem } from './useEntityQueries'
import { agentTaskToCoopItem } from './useCoopExploreData'

export type EntityContentType =
  | 'product'
  | 'service'
  | 'agent'
  | 'catalog'
  | 'bounty'
  | 'cooperation'

export interface EntityContentItem {
  id: string
  contentType: EntityContentType
  title: string
  description?: string
  images?: string[]
  priceSats?: number
  budgetSats?: number
  createdAt: string
  detailPath?: string
  /** Set for product/service/agent items (rendered via OfferListRow). */
  offer?: Offer
  /** Set for bounty/cooperation items (rendered via CoopListRow). */
  coopItem?: CoopItem
  /** Set for catalog items (rendered via the local CatalogRow). */
  catalog?: Catalog
}

const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 30_000

function offerTypeToContentType(offerType?: string): EntityContentType {
  if (offerType === 'SERVICE') return 'service'
  if (offerType === 'AGENT_SETUP') return 'agent'
  return 'product'
}

export async function fetchEntityOwnedContent(pubkey: string, companyId?: string, owner = false): Promise<EntityContentItem[]> {
  const [offersRes, catalogsCompanyRes, catalogsOwnerRes, bountiesRes, coopsRes] = await Promise.all([
    apiCall(`/api/offers?creatorPubkey=${pubkey}`).then(r => r.json()).catch(() => ({ offers: [] })),
    companyId
      ? apiCall(`/api/catalog?companyId=${companyId}`).then(r => r.json()).catch(() => ({ catalogs: [] }))
      : Promise.resolve({ catalogs: [] }),
    apiCall(`/api/catalog?ownerPubkey=${pubkey}`).then(r => r.json()).catch(() => ({ catalogs: [] })),
    apiCall(`/api/agent-tasks?creatorPubkey=${pubkey}&limit=100`).then(r => r.json()).catch(() => ({ tasks: [] })),
    apiCall(`/api/cooperations/by-pubkey/${pubkey}`).then(r => r.json()).catch(() => ({ cooperations: [] })),
  ])

  // The `?creatorPubkey=` endpoints return ALL statuses (the server exempts the
  // owner-scoped view from the ACTIVE/PRIVATE/blocked filters). Public profiles
  // must only surface published content (ACTIVE offers, OPEN bounties, active
  // catalogs); the owner's management view (owner=true) sees everything.
  const offers = ((offersRes.offers ?? []) as Offer[]).filter(o => owner || o.status === 'ACTIVE')
  const catalogs = [
    ...((catalogsCompanyRes.catalogs ?? []) as Catalog[]),
    ...((catalogsOwnerRes.catalogs ?? []) as Catalog[]),
  ].filter(c => owner || c.isActive !== false)
  const bounties = ((bountiesRes.tasks ?? []) as AgentTask[]).filter(t => owner || t.status === 'OPEN')
  const coops = (coopsRes.cooperations ?? []) as Record<string, unknown>[]

  const items: EntityContentItem[] = []

  for (const offer of offers) {
    if (offer.offerType === 'COOP') {
      // Network cooperations are Offer records (offerType=COOP) — surface them
      // alongside Cooperation rows in the same 'cooperation' facet.
      const coopItem = offerToCoopItem(offer as unknown as Record<string, unknown>)
      items.push({
        id: `coop-offer-${offer.id}`,
        contentType: 'cooperation',
        title: offer.title,
        description: coopItem.description,
        budgetSats: coopItem.priceSats,
        createdAt: coopItem.createdAt ?? offer.createdAt,
        detailPath: coopItem.detailPath,
        coopItem,
      })
      continue
    }
    items.push({
      id: offer.id,
      contentType: offerTypeToContentType(offer.offerType),
      title: offer.title,
      description: richTextToPlainText(offer.description),
      images: offer.images,
      priceSats: offer.priceSats,
      createdAt: offer.createdAt,
      detailPath: `/buy/product/${offer.id}`,
      offer,
    })
  }

  for (const catalog of catalogs) {
    items.push({
      id: `catalog-${catalog.id}`,
      contentType: 'catalog',
      title: catalog.name,
      description: catalog.description ?? undefined,
      createdAt: catalog.createdAt,
      catalog,
    })
  }

  for (const task of bounties) {
    const coopItem = agentTaskToCoopItem(task)
    items.push({
      id: `bounty-${task.id}`,
      contentType: 'bounty',
      title: task.title,
      description: task.description,
      budgetSats: task.budgetSats,
      createdAt: task.createdAt,
      detailPath: `/bounties/${task.id}`,
      coopItem,
    })
  }

  for (const coop of coops) {
    const coopItem = coopToCoopItem(coop)
    items.push({
      id: `cooperation-${coop.id as string}`,
      contentType: 'cooperation',
      title: coopItem.title,
      description: coopItem.description,
      budgetSats: coopItem.budgetSats,
      createdAt: coopItem.createdAt ?? '',
      detailPath: coopItem.detailPath,
      coopItem,
    })
  }

  const seen = new Set<string>()
  return items.filter((i) => {
    if (seen.has(i.id)) return false
    seen.add(i.id)
    return true
  })
}

export function useEntityOwnedContent(pubkey: string, companyId?: string, owner = false) {
  const query = useQuery({
    queryKey: ['entity-owned-content', pubkey, companyId ?? '', owner],
    queryFn: () => fetchEntityOwnedContent(pubkey, companyId, owner),
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
    placeholderData: keepPreviousData,
  })

  return {
    items: query.data ?? [],
    loading: query.isLoading,
  }
}
