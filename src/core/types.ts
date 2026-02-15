export type LimitPolicy = {
  windowMs: number
  max: number
  keyPrefix?: string
}

export type LimitCheck = {
  allowed: boolean
  remaining: number
  resetMs: number
}

export interface TokenEstimator {
  estimate(text: string): number
}

export interface GuardConfig {
  minuteTokenLimit: number
  dailyCostLimitUSD: number
  blockOnViolation?: boolean
}

export interface LLMRequest {
  subjectId: string
  model: string
  prompt: string
}

export interface LLMResponse {
  output: string
  totalTokens: number
}

export interface GuardHooksContext {
  request: LLMRequest
  config: GuardConfig
  response?: LLMResponse
  reason?: string
  error?: unknown
}

export interface GuardHooks {
  onAllowed?(context: GuardHooksContext): void | Promise<void>
  onBlocked?(context: GuardHooksContext): void | Promise<void>
  onError?(context: GuardHooksContext): void | Promise<void>
}
