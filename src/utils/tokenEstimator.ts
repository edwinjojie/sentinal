import { TokenEstimator } from '../core/types'

export class SimpleEstimator implements TokenEstimator {
  estimate(text: string): number {
    return Math.ceil(text.length / 4)
  }
}

export class AdaptiveEstimator implements TokenEstimator {
  // Model -> Multiplier (chars to tokens)
  // Default: 0.25 (1 token per 4 chars)
  private multipliers = new Map<string, number>()
  private counts = new Map<string, number>()

  estimate(text: string, model: string = 'default'): number {
    const mult = this.multipliers.get(model) || 0.25
    return Math.ceil(text.length * mult)
  }

  recordActual(prompt: string, actualTokens: number, model: string = 'default'): void {
    const currentMult = this.multipliers.get(model) || 0.25
    const currentCount = this.counts.get(model) || 0

    // Calculate observed multiplier for this request
    const observedMult = actualTokens / Math.max(1, prompt.length)

    // Update running average
    // NewAvg = (OldAvg * Count + NewObs) / (Count + 1)
    const newMult = (currentMult * currentCount + observedMult) / (currentCount + 1)

    this.multipliers.set(model, newMult)
    this.counts.set(model, currentCount + 1)
  }
}

const defaultEstimator = new AdaptiveEstimator()

export function estimateTokens(text: string): number {
  return defaultEstimator.estimate(text)
}

export { defaultEstimator as simpleEstimator }
