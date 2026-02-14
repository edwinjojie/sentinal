import createRedisClient from '../src/storage/redisClient'
import { UsageStore } from '../src/storage/usageStore'
import { RedisLimiter } from '../src/core/limiter'
import { BasicGuard } from '../src/core/guard'

async function main() {
  const client = createRedisClient()
  const store = new UsageStore(client, 'sentinal')
  const limiter = new RedisLimiter(store, { windowMs: 60_000, max: 5, keyPrefix: 'demo' })
  const guard = new BasicGuard(limiter)
  const key = 'user:123'
  const res = await limiter.check(key)
  const allowed = await guard.allow(key)
  console.log({ allowed, res })
  await client.quit()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
