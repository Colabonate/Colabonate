import { MeiliSearch } from 'meilisearch'

let client: MeiliSearch | null = null
let initialized = false

export function getMeili(): MeiliSearch | null {
  if (initialized) return client
  initialized = true
  if (!process.env.MEILISEARCH_URL) return null
  client = new MeiliSearch({
    host: process.env.MEILISEARCH_URL,
    apiKey: process.env.MEILISEARCH_MASTER_KEY,
  })
  return client
}
