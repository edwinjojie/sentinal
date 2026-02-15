import { TokenEstimator } from '../core/types'

export class SimpleEstimator implements TokenEstimator {
  estimate(text: string): number {
    return Math.ceil(text.length / 4)
  }
}

const defaultEstimator = new SimpleEstimator()

export function estimateTokens(text: string): number {
  return defaultEstimator.estimate(text)
}

export { defaultEstimator as simpleEstimator }
