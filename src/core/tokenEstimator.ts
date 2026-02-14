import { TokenEstimator } from './types'

export class SimpleTokenEstimator implements TokenEstimator {
  estimate(input: string): number {
    const trimmed = input.trim()
    if (!trimmed) return 0
    return Math.ceil(trimmed.split(/\s+/).length)
  }
}

export default SimpleTokenEstimator
