export const PRICE_PER_1K_TOKENS = 0.002
// Precompute cost per token to avoid division at runtime
// 0.002 / 1000 = 0.000002
export const COST_PER_TOKEN = PRICE_PER_1K_TOKENS / 1000

export function calculateCost(tokens: number): number {
  return tokens * COST_PER_TOKEN
}

export function costToCents(cost: number): number {
  return Math.round(cost * 100)
}
