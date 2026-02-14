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
  estimate(input: string): number
}

export interface CostCalculator {
  calculateTokens(input: string): number
  calculateCost(tokens: number): number
}

export interface Limiter {
  check(key: string): Promise<LimitCheck>
}

export interface Guard {
  allow(key: string): Promise<boolean>
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
