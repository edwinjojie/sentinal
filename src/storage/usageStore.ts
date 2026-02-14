import type Redis from 'ioredis'

export class UsageStore {
  private prefix: string
  private client: Redis

  constructor(client: Redis, prefix = 'sentinal') {
    this.client = client
    this.prefix = prefix
  }

  private makeKey(key: string, windowMs: number): string {
    const bucket = Math.floor(Date.now() / windowMs)
    return `${this.prefix}:${key}:${bucket}`
  }

  async increment(key: string, windowMs: number): Promise<number> {
    const k = this.makeKey(key, windowMs)
    const count = await this.client.incr(k)
    await this.client.pexpire(k, windowMs)
    return count
  }

  async ttlMs(key: string, windowMs: number): Promise<number> {
    const k = this.makeKey(key, windowMs)
    const ttl = await this.client.pttl(k)
    return ttl < 0 ? 0 : ttl
  }
}

export default UsageStore
