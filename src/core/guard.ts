import { Guard, Limiter } from './types'

export class BasicGuard implements Guard {
  private limiter: Limiter

  constructor(limiter: Limiter) {
    this.limiter = limiter
  }

  async allow(key: string): Promise<boolean> {
    const res = await this.limiter.check(key)
    return res.allowed
  }
}

export default BasicGuard
