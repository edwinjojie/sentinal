import { GuardConfig, LLMRequest, LLMResponse, TokenEstimator } from './types'
import {
  reserveBudget,
  adjustBudget,
  checkPromptSimilarity,
  checkDailySpendSpike,
  recordDailySpend,
} from '../storage/usageStore'
import { hashPrompt } from '../utils/promptHash'
import { calculateCost, costToCents } from './costCalculator'

export interface EnforcementResult {
  allowed: boolean
  reason?: string
  estimatedTokens: number
  estimatedCostCents: number
  minuteTokens?: number | null
  rollingAvgTokens?: number | null
  velocitySpike?: boolean
  abuseFlags?: string[]
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

    const abuseFlags: string[] = []

    if (config.abuseDetection) {
      if (
        config.abuseDetection.promptSimilarityWindowMs &&
        config.abuseDetection.promptSimilarityThreshold
      ) {
        const hash = hashPrompt(request.prompt)
        const isSimilar = await checkPromptSimilarity(
          request.subjectId,
          request.model,
          hash,
          config.abuseDetection.promptSimilarityWindowMs,
          config.abuseDetection.promptSimilarityThreshold,
        )
        if (isSimilar) {
          abuseFlags.push('PROMPT_ENUMERATION')
        }
      }

      if (config.abuseDetection.spendSpikeMultiplier) {
        const isSpike = await checkDailySpendSpike(
          request.subjectId,
          request.model,
          estimatedCostCents,
          config.abuseDetection.spendSpikeMultiplier,
        )
        if (isSpike) {
          abuseFlags.push('SPEND_SPIKE')
        }
      }
    }

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
        abuseFlags,
      }
    }

    // Also block if we have abuse flags and blockOnViolation is set
    if (abuseFlags.length > 0 && config.blockOnViolation) {
      return {
        allowed: false,
        reason: `Abuse detected: ${abuseFlags.join(', ')}`,
        estimatedTokens,
        estimatedCostCents,
        abuseFlags,
      }
    }

    return {
      allowed: true,
      estimatedTokens,
      estimatedCostCents,
      minuteTokens: reservation.minuteTokens ?? null,
      rollingAvgTokens: reservation.rollingAvgTokens ?? null,
      velocitySpike: reservation.velocitySpike ?? false,
      abuseFlags,
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

    // Always record daily spend to maintain accurate EMA
    await recordDailySpend(request.subjectId, request.model, actualCostCents)
  }
}
