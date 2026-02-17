import {
  GuardConfig,
  GuardHooks,
  GuardHooksContext,
  LLMRequest,
} from './types'
import { LLMProvider } from '../providers/llmProvider'
import { EnforcementEngine } from './enforcementEngine'
import { simpleEstimator } from '../utils/tokenEstimator'
import { LimitExceededError } from './errors'

export class SentinalGuard {
  private provider: LLMProvider
  private config: GuardConfig
  private hooks?: GuardHooks
  private engine: EnforcementEngine

  constructor(
    provider: LLMProvider,
    config: GuardConfig,
    hooks?: GuardHooks,
  ) {
    if (config.minuteTokenLimit <= 0) {
      throw new Error('Invalid minuteTokenLimit')
    }

    if (config.dailyCostLimitUSD <= 0) {
      throw new Error('Invalid dailyCostLimitUSD')
    }

    this.provider = provider
    this.config = config
    this.hooks = hooks
    this.engine = new EnforcementEngine({ estimator: simpleEstimator })
  }

  async generate(request: LLMRequest) {
    const baseContext: GuardHooksContext = {
      request,
      config: this.config,
    }

    try {
      const result = await this.engine.reserve(
        request,
        this.config,
      )

      let reservedTokens = 0
      let reservedCostCents = 0

      if (!result.allowed && this.config.blockOnViolation) {
        const error = new LimitExceededError(result.reason || 'Limit exceeded')

        if (this.hooks?.onBlocked) {
          await this.hooks.onBlocked({
            ...baseContext,
            reason: result.reason,
            error,
          })
        }

        throw error
      }

      // If allowed, we reserved the estimated amount.
      // If not allowed (but proceeding due to !blockOnViolation), we reserved 0.
      if (result.allowed) {
        reservedTokens = result.estimatedTokens
        reservedCostCents = result.estimatedCostCents
      }

      const response = await this.provider.generate(request)

      await this.engine.commit(
        request,
        response,
        reservedTokens,
        reservedCostCents,
      )

      if (this.hooks?.onAllowed) {
        await this.hooks.onAllowed({
          ...baseContext,
          response,
        })
      }

      return response
    } catch (err) {
      if (err instanceof LimitExceededError) {
        // Already handled explicitly above if expected. 
        // But if for some reason it bubbles up (shouldn't), rethrow.
        throw err
      }

      if (this.hooks?.onError) {
        await this.hooks.onError({
          ...baseContext,
          error: err,
        })
      }

      throw err
    }
  }
}
