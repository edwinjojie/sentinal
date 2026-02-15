import { GuardConfig } from './types'
import { getUsage } from '../storage/usageStore'

export async function checkLimits(subjectId: string, config: GuardConfig) {
  const usage = await getUsage(subjectId)
  const dailyLimitCents = Math.round(config.dailyCostLimitUSD * 100)

  if (usage.minuteTokens > config.minuteTokenLimit) {
    return { allowed: false, reason: 'Minute token limit exceeded' }
  }

  if (usage.dailyCostCents > dailyLimitCents) {
    return { allowed: false, reason: 'Daily cost limit exceeded' }
  }

  return { allowed: true as const }
}
