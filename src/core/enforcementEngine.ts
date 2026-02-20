import { GuardConfig, LLMRequest, LLMResponse, TokenEstimator } from './types'
import { reserveBudget, adjustBudget } from '../storage/usageStore'
import { calculateCost, costToCents } from './costCalculator'

export interface EnforcementResult {
  allowed: boolean
  reason?: string
  estimatedTokens: number
  estimatedCostCents: number
  minuteTokens?: number | null
  rollingAvgTokens?: number | null
  velocitySpike?: boolean
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
    const estimatedTokens = this.estimator.estimate(request.prompt, request.model)
    const estimatedCost = calculateCost(estimatedTokens)
    const estimatedCostCents = costToCents(estimatedCost)

    const minuteLimit = config.minuteTokenLimit
    const dailyLimitCents = costToCents(config.dailyCostLimitUSD)

    const reservation = await reserveBudget(
      request.subjectId,
      request.model,
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
      minuteTokens: reservation.minuteTokens ?? null,
      rollingAvgTokens: reservation.rollingAvgTokens ?? null,
      velocitySpike: reservation.velocitySpike ?? false,
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

    await adjustBudget(request.subjectId, request.model, deltaTokens, deltaCostCents)

    if (this.estimator.recordActual) {
      this.estimator.recordActual(request.prompt, response.totalTokens, request.model)
    }
  }
}
