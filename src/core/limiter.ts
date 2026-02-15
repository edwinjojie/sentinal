import { GuardConfig } from './types'
import { getMinuteTokens, getDailyCost } from '../storage/usageStore'

export async function checkLimits(subjectId: string, config: GuardConfig) {
  const minuteTokens = await getMinuteTokens(subjectId)
  const dailyCost = await getDailyCost(subjectId)

  if (minuteTokens > config.minuteTokenLimit) {
    return { allowed: false, reason: 'Minute token limit exceeded' }
  }

  if (dailyCost > config.dailyCostLimitUSD) {
    return { allowed: false, reason: 'Daily cost limit exceeded' }
  }

  return { allowed: true as const }
}
