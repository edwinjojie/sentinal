import { CostCalculator } from './types'

export class BasicCostCalculator implements CostCalculator {
  private tokensPerUnit: number
  private unitCost: number

  constructor(tokensPerUnit = 1000, unitCost = 0.002) {
    this.tokensPerUnit = tokensPerUnit
    this.unitCost = unitCost
  }

  calculateTokens(input: string): number {
    return Math.max(0, input.length)
  }

  calculateCost(tokens: number): number {
    return (tokens / this.tokensPerUnit) * this.unitCost
  }
}

export default BasicCostCalculator
