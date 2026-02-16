import { GuardConfig, LLMRequest, LLMResponse, TokenEstimator } from './types'
import {
  reserveBudget,
  adjustBudget,
} from '../storage/usageStore'
import { calculateCost, costToCents } from './costCalculator'
import { LimitExceededError } from './errors'

export type EnforcementReservationResult =
  | { allowed: true }
  | { allowed: false; reason: string }

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
  ): Promise<{
    estimatedTokens: number
    estimatedCostCents: number
  }> {
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

    if (!reservation.allowed && config.blockOnViolation) {
      throw new LimitExceededError(reservation.reason)
    }

    return {
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

