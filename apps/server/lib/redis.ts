import Redis from 'ioredis'

let client: Redis | null = null
let initialized = false

export function getRedis(): Redis | null {
  if (initialized) return client
  // Defer setting `initialized` until we know REDIS_URL is set.
  // Module-import order in index.ts can call getRedis() BEFORE dotenv.config
  // has injected REDIS_URL (ES module imports are hoisted above the explicit
  // `dotenv.config()` call). If we set initialized=true on a missing env var,
  // the client stays null forever. See FOLLOWUPS.md FU-212-G.
  if (!process.env.REDIS_URL) return null
  initialized = true
  client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  })
  client.connect().catch(() => { /* lazy retry */ })
  return client
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => { /* ignore */ })
    client = null
    initialized = false
  }
}
