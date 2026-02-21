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
  estimate(text: string, model?: string): number
  recordActual?(prompt: string, actualTokens: number, model?: string): void
}

export interface AbuseScoreWeights {
  velocitySpike?: number
  promptRepetition?: number
  spendSpike?: number
  budgetExhaustion?: number
}

export interface AbuseScoreThresholds {
  softThrottle: number
  hardBlock: number
  throttleDelayMs: number
  exhaustionTriggerCount?: number
}

export interface AbuseDetectionConfig {
  promptSimilarityWindowMs?: number
  promptSimilarityThreshold?: number
  spendSpikeMultiplier?: number
  scoreWeights?: AbuseScoreWeights
  scoreThresholds?: AbuseScoreThresholds
}

export interface GuardConfig {
  minuteTokenLimit: number
  dailyCostLimitUSD: number
  blockOnViolation?: boolean
  abuseDetection?: AbuseDetectionConfig
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
  minuteTokens?: number | null
  rollingAvgTokens?: number | null
  velocitySpike?: boolean
  abuseFlags?: string[]
  abuseScore?: number
  softThrottled?: boolean
}

export interface GuardHooks {
  onAllowed?(context: GuardHooksContext): void | Promise<void>
  onBlocked?(context: GuardHooksContext): void | Promise<void>
  onError?(context: GuardHooksContext): void | Promise<void>
}
