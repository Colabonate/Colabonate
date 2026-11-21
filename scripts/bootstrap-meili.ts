import { MeiliSearch } from 'meilisearch'
import { OFFER_INDEX_ALIAS, OFFER_INDEX_NAME, OFFER_INDEX_SETTINGS } from '../apps/server/services/search-config.js'

const client = new MeiliSearch({ host: 'http://localhost:7700', apiKey: 'dev-master-key' })

async function main() {
  const indexes = await client.getIndexes()
  console.log('Current indexes:', indexes.results.map((i: any) => i.uid))

  const aliasIndex = indexes.results.find((i: any) => i.uid === OFFER_INDEX_ALIAS)
  if (aliasIndex) {
    console.log('Alias already exists')
  } else {
    console.log('Need to create index')
    const versionIndex = indexes.results.find((i: any) => i.uid === OFFER_INDEX_NAME)
    if (!versionIndex) {
      await client.createIndex(OFFER_INDEX_NAME, { primaryKey: 'id' })
      console.log('Created', OFFER_INDEX_NAME)
      await client.index(OFFER_INDEX_NAME).updateSettings(OFFER_INDEX_SETTINGS)
      console.log('Applied settings')
    }

    try {
      await client.swapIndexes([{ indexes: [OFFER_INDEX_NAME, OFFER_INDEX_ALIAS] }])
      console.log('Swapped indexes')
    } catch (e: any) {
      console.log('Swap error:', e.message, '- using versioned index directly')
    }
  }

  const finalIndexes = await client.getIndexes()
  console.log('Final indexes:', finalIndexes.results.map((i: any) => i.uid))

  const aliasCheck = finalIndexes.results.find((i: any) => i.uid === OFFER_INDEX_ALIAS)
  console.log('Alias exists:', !!aliasCheck)
  console.log('Available indexes:', finalIndexes.results.map((i: any) => i.uid))
}

main().catch(console.error)