import { GuardConfig, LLMRequest } from './types'
import { LLMProvider } from '../providers/llmProvider'
import {
  incrementMinuteTokens,
  incrementDailyCostCents,
  reserveBudget,
} from '../storage/usageStore'
import { calculateCost, costToCents } from './costCalculator'
import { estimateTokens } from '../utils/tokenEstimator'

export class SentinalGuard {
  private provider: LLMProvider
  private config: GuardConfig

  constructor(provider: LLMProvider, config: GuardConfig) {
    this.provider = provider
    this.config = config
  }

  async generate(request: LLMRequest) {
    const estimatedTokens = estimateTokens(request.prompt)
    const estimatedCost = calculateCost(estimatedTokens)
    const estimatedCostCents = costToCents(estimatedCost)

    const minuteLimit = this.config.minuteTokenLimit
    const dailyLimitCents = costToCents(this.config.dailyCostLimitUSD)

    const reservation = await reserveBudget(
      request.subjectId,
      estimatedTokens,
      minuteLimit,
      estimatedCostCents,
      dailyLimitCents,
    )

    if (!reservation.allowed && this.config.blockOnViolation) {
      throw new Error(reservation.reason)
    }

    const response = await this.provider.generate(request)
    const actualCost = calculateCost(response.totalTokens)
    const actualCostCents = costToCents(actualCost)

    const deltaTokens = response.totalTokens - estimatedTokens
    const deltaCostCents = actualCostCents - estimatedCostCents

    if (deltaTokens > 0) {
      await incrementMinuteTokens(request.subjectId, deltaTokens)
    }

    if (deltaCostCents > 0) {
      await incrementDailyCostCents(request.subjectId, deltaCostCents)
    }

    return response
  }
}
