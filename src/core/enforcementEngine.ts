import { GuardConfig, LLMRequest, LLMResponse, TokenEstimator } from './types'
import {
  reserveBudget,
  adjustBudget,
} from '../storage/usageStore'
import { calculateCost, costToCents } from './costCalculator'
// LimitExceededError removed
export interface EnforcementResult {
  allowed: boolean
  reason?: string
  estimatedTokens: number
  estimatedCostCents: number
}

export interface EnforcementEngineOptions {
  estimator: TokenEstimator
}

export class EnforcementEngine {
  private estimator: TokenEstimator

  constructor(options: EnforcementEngineOptions) {
    this.estimator = options.estimator
  }

  async reserve(
    request: LLMRequest,
    config: GuardConfig,
  ): Promise<EnforcementResult> {
    const estimatedTokens = this.estimator.estimate(request.prompt)
    const estimatedCost = calculateCost(estimatedTokens)
    const estimatedCostCents = costToCents(estimatedCost)

    const minuteLimit = config.minuteTokenLimit
    const dailyLimitCents = costToCents(config.dailyCostLimitUSD)

    const reservation = await reserveBudget(
      request.subjectId,
      estimatedTokens,
      minuteLimit,
      estimatedCostCents,
      dailyLimitCents,
    )

    if (!reservation.allowed) {
      return {
        allowed: false,
        reason: reservation.reason,
        estimatedTokens,
        estimatedCostCents,
      }
    }

    return {
      allowed: true,
      estimatedTokens,
      estimatedCostCents,
    }
  }

  async commit(
    request: LLMRequest,
    response: LLMResponse,
    estimatedTokens: number,
    estimatedCostCents: number,
  ): Promise<void> {
    const actualCost = calculateCost(response.totalTokens)
    const actualCostCents = costToCents(actualCost)

    const deltaTokens = estimatedTokens - response.totalTokens
    const deltaCostCents = estimatedCostCents - actualCostCents

    await adjustBudget(request.subjectId, deltaTokens, deltaCostCents)
  }
}

