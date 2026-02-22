import { GuardConfig, LLMRequest, LLMResponse, TokenEstimator } from './types'
import {
  reserveBudget,
  adjustBudget,
  checkPromptSimilarity,
  checkDailySpendSpike,
  recordDailySpend,
  incrementAbuseScore,
  incrementExhaustionCount,
  recordTokenDensity,
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
  abuseScore?: number
  softThrottled?: boolean
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

    if (reservation.velocitySpike) {
      abuseFlags.push('VELOCITY_SPIKE')
    }

    // Check for near budget exhaustion (< 10% remaining)
    if (
      reservation.remainingTokens !== undefined &&
      reservation.remainingTokens !== null &&
      reservation.remainingTokens < minuteLimit * 0.1
    ) {
      const exhaustionCount = await incrementExhaustionCount(request.subjectId, request.model)

      const triggerCount = config.abuseDetection?.scoreThresholds ?
        (config.abuseDetection.scoreThresholds as any).exhaustionTriggerCount || 3 : 3;

      if (exhaustionCount >= triggerCount) {
        abuseFlags.push('BUDGET_EXHAUSTION')
      }
    }

    let currentAbuseScore = 0
    let softThrottled = false

    if (config.abuseDetection?.scoreWeights && abuseFlags.length > 0) {
      let scoreDelta = 0
      const weights = config.abuseDetection.scoreWeights

      if (abuseFlags.includes('PROMPT_ENUMERATION')) scoreDelta += weights.promptRepetition || 0
      if (abuseFlags.includes('SPEND_SPIKE')) scoreDelta += weights.spendSpike || 0
      if (abuseFlags.includes('VELOCITY_SPIKE')) scoreDelta += weights.velocitySpike || 0
      if (abuseFlags.includes('BUDGET_EXHAUSTION')) scoreDelta += weights.budgetExhaustion || 0

      if (scoreDelta > 0) {
        currentAbuseScore = await incrementAbuseScore(request.subjectId, request.model, scoreDelta)
      }
    }

    const { scoreThresholds } = config.abuseDetection || {}

    // 1. Hard block if it exceeds the hardBlock threshold
    if (scoreThresholds && currentAbuseScore >= scoreThresholds.hardBlock) {
      return {
        allowed: false,
        reason: `Abuse score ${currentAbuseScore} exceeds hard block threshold`,
        estimatedTokens,
        estimatedCostCents,
        abuseFlags,
        abuseScore: currentAbuseScore,
      }
    }

    // 2. Original reservation block
    if (!reservation.allowed) {
      return {
        allowed: false,
        reason: reservation.reason,
        estimatedTokens,
        estimatedCostCents,
        abuseFlags,
        abuseScore: currentAbuseScore,
      }
    }

    // 3. Fallback to old blockOnViolation if thresholds aren't defined but flags exist
    if (!scoreThresholds && abuseFlags.length > 0 && config.blockOnViolation) {
      return {
        allowed: false,
        reason: `Abuse detected: ${abuseFlags.join(', ')}`,
        estimatedTokens,
        estimatedCostCents,
        abuseFlags,
      }
    }

    // 4. Soft throttle check
    if (scoreThresholds && currentAbuseScore >= scoreThresholds.softThrottle) {
      softThrottled = true
    }

    return {
      allowed: true,
      estimatedTokens,
      estimatedCostCents,
      minuteTokens: reservation.minuteTokens ?? null,
      rollingAvgTokens: reservation.rollingAvgTokens ?? null,
      velocitySpike: reservation.velocitySpike ?? false,
      abuseFlags,
      abuseScore: currentAbuseScore,
      softThrottled,
    }
  }

  async commit(
    request: LLMRequest,
    response: LLMResponse,
    config: GuardConfig,
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

    // Token Density Anomaly Detection
    const configWeight = config.abuseDetection?.scoreWeights?.tokenDensityAnomaly
    const multiplier = config.abuseDetection?.tokenDensityMultiplier

    if (configWeight && multiplier) {
      // Estimate input tokens to calculate ratio
      const inputTokens = this.estimator.estimate(request.prompt, request.model)
      const outputTokens = Math.max(0, response.totalTokens - inputTokens)

      const isAnomaly = await recordTokenDensity(
        request.subjectId,
        request.model,
        inputTokens,
        outputTokens,
        multiplier
      )

      if (isAnomaly) {
        await incrementAbuseScore(request.subjectId, request.model, configWeight)
      }
    }
  }
}
