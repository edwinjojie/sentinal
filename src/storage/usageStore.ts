import { redis } from './redisClient'
import { INCREMENT_WITH_TTL } from './scripts'

const MINUTE_TTL_SECONDS = 60
const DAILY_TTL_SECONDS = 86400

function minuteKey(subjectId: string): string {
  return `sentinal:minute:${subjectId}`
}

function dailyKey(subjectId: string): string {
  return `sentinal:daily:${subjectId}`
}

export async function incrementMinuteTokens(subjectId: string, tokens: number) {
  const key = minuteKey(subjectId)
  await redis.eval(INCREMENT_WITH_TTL, 1, key, tokens, MINUTE_TTL_SECONDS)
}

export async function getUsage(subjectId: string) {
  const mKey = minuteKey(subjectId)
  const dKey = dailyKey(subjectId)

  const pipeline = redis.pipeline()
  pipeline.get(mKey)
  pipeline.get(dKey)
  const results = await pipeline.exec()

  const minuteVal = (results[0]?.[1] as string | null) ?? null
  const dailyVal = (results[1]?.[1] as string | null) ?? null

  return {
    minuteTokens: parseInt(minuteVal || '0'),
    dailyCostCents: parseInt(dailyVal || '0'),
  }
}

export async function incrementDailyCostCents(
  subjectId: string,
  costCents: number,
) {
  const key = dailyKey(subjectId)
  await redis.eval(INCREMENT_WITH_TTL, 1, key, costCents, DAILY_TTL_SECONDS)
}

export async function reserveBudget(
  subjectId: string,
  tokens: number,
  minuteLimit: number,
  costCents: number,
  dailyLimitCents: number,
) {
  const mKey = minuteKey(subjectId)
  const dKey = dailyKey(subjectId)

  const newMinute = Number(
    await redis.eval(INCREMENT_WITH_TTL, 1, mKey, tokens, MINUTE_TTL_SECONDS),
  )

  const newDaily = Number(
    await redis.eval(
      INCREMENT_WITH_TTL,
      1,
      dKey,
      costCents,
      DAILY_TTL_SECONDS,
    ),
  )

  if (newMinute > minuteLimit) {
    await redis.decrby(mKey, tokens)
    await redis.decrby(dKey, costCents)
    return { allowed: false as const, reason: 'Minute token limit exceeded' }
  }

  if (newDaily > dailyLimitCents) {
    await redis.decrby(mKey, tokens)
    await redis.decrby(dKey, costCents)
    return { allowed: false as const, reason: 'Daily cost limit exceeded' }
  }

  return { allowed: true as const }
}
