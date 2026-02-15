import { GuardConfig, LLMRequest } from './types'
import { LLMProvider } from '../providers/llmProvider'
import { checkLimits } from './limiter'
import {
  incrementMinuteTokens,
  incrementDailyCost,
} from '../storage/usageStore'
import { calculateCost } from './costCalculator'

export class SentinalGuard {
  private provider: LLMProvider
  private config: GuardConfig

  constructor(provider: LLMProvider, config: GuardConfig) {
    this.provider = provider
    this.config = config
  }

  async generate(request: LLMRequest) {
    const limitCheck = await checkLimits(request.subjectId, this.config)

    if (!limitCheck.allowed && this.config.blockOnViolation) {
      throw new Error(limitCheck.reason)
    }

    const response = await this.provider.generate(request)
    const cost = calculateCost(response.totalTokens)

    await incrementMinuteTokens(request.subjectId, response.totalTokens)
    await incrementDailyCost(request.subjectId, cost)

    return response
  }
}
