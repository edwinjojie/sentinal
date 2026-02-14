import Redis from 'ioredis'

export type RedisClient = Redis

export function createRedisClient(url?: string): RedisClient {
  const redisUrl = url || process.env.REDIS_URL || 'redis://localhost:6379'
  return new Redis(redisUrl)
}

export default createRedisClient
