import { SimplePool } from 'nostr-tools'

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band']
const pool = new SimplePool()

async function scanRelays() {
  console.log('Connecting to relays to find recent 30018 events...')
  
  const sub = pool.subscribeMany(
    RELAYS,
    {
      kinds: [30018],
      since: Math.floor(Date.now() / 1000) - 3600, // last 1 hour
    },
    {
      onevent(event) {
        console.log(`Found Event: ${event.id} by ${event.pubkey}`)
        console.log(`Tags:`, JSON.stringify(event.tags))
      },
      oneose() {
        console.log('End of stored events.')
        sub.close()
        process.exit(0)
      }
    }
  )

  setTimeout(() => {
    console.log('Timeout. Closing.')
    sub.close()
    process.exit(0)
  }, 10000)
}

scanRelays().catch(console.error)
