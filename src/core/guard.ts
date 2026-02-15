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
      const { estimatedTokens, estimatedCostCents } = await this.engine.reserve(
        request,
        this.config,
      )

      const response = await this.provider.generate(request)

      await this.engine.commit(
        request,
        response,
        estimatedTokens,
        estimatedCostCents,
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
        if (this.hooks?.onBlocked) {
          await this.hooks.onBlocked({
            ...baseContext,
            reason: err.reason,
            error: err,
          })
        }
      } else if (this.hooks?.onError) {
        await this.hooks.onError({
          ...baseContext,
          error: err,
        })
      }

      throw err
    }
  }
}
