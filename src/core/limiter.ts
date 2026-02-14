import { LimitPolicy, Limiter, LimitCheck } from './types'
import { UsageStore } from '../storage/usageStore'

export class RedisLimiter implements Limiter {
  private store: UsageStore
  private policy: LimitPolicy

  constructor(store: UsageStore, policy: LimitPolicy) {
    this.store = store
    this.policy = policy
  }

  async check(key: string): Promise<LimitCheck> {
    const k = this.policy.keyPrefix ? `${this.policy.keyPrefix}:${key}` : key
    const count = await this.store.increment(k, this.policy.windowMs)
    const allowed = count <= this.policy.max
    const remaining = allowed ? this.policy.max - count : 0
    const resetMs = await this.store.ttlMs(k, this.policy.windowMs)
    return { allowed, remaining, resetMs }
  }
}

export default RedisLimiter
