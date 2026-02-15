export function calculateCost(tokens: number): number {
  const pricePer1k = 0.002
  return (tokens / 1000) * pricePer1k
}
