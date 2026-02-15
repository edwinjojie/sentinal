export class LimitExceededError extends Error {
  reason: string

  constructor(reason: string) {
    super(reason)
    this.name = 'LimitExceededError'
    this.reason = reason
  }
}

