import { redis } from './redisClient'
import { RESERVE_BUDGET } from './scripts'

const MINUTE_TTL_SECONDS = 60
const DAILY_TTL_SECONDS = 86400

function minuteKey(subjectId: string): string {
  return `sentinal:budget:minute:${subjectId}`
}

function dailyKey(subjectId: string): string {
  return `sentinal:budget:daily:${subjectId}`
}

export async function getRemainingBudget(subjectId: string) {
  const mKey = minuteKey(subjectId)
  const dKey = dailyKey(subjectId)

  const pipeline = redis.pipeline()
  pipeline.get(mKey)
  pipeline.get(dKey)
  /* flattener */
  const results = await pipeline.exec()

  if (!results) {
    return {
      minuteRemaining: null,
      dailyRemaining: null,
    }
  }

  const minuteVal = (results[0]?.[1] as string | null) ?? null
  const dailyVal = (results[1]?.[1] as string | null) ?? null

  return {
    minuteRemaining: minuteVal ? parseInt(minuteVal) : null, // null means no budget initialized (full limit available effectively)
    dailyRemaining: dailyVal ? parseInt(dailyVal) : null,
  }
}

export async function adjustBudget(
  subjectId: string,
  tokenDelta: number,
  costCentsDelta: number,
) {
  const mKey = minuteKey(subjectId)
  const dKey = dailyKey(subjectId)

  // tokenDelta is (estimated - actual). 
  // If positive, we reserved too much, so we add back: INCRBY tokenDelta
  // If negative, we reserved too little, so we consume more: INCRBY tokenDelta (adds negative = subtracts)
  // HOWEVER, wait. 
  // Reserve: DECRBY requested. 
  // Adjust: We want to set budget to (Initial - Actual). 
  // Currently budget = (Initial - Estimated).
  // We want new budget = (Initial - Estimated) + (Estimated - Actual) = Initial - Actual.
  // So we just add (Estimated - Actual).

  const pipeline = redis.pipeline()
  if (tokenDelta !== 0) {
    pipeline.incrby(mKey, tokenDelta)
  }
  if (costCentsDelta !== 0) {
    pipeline.incrby(dKey, costCentsDelta)
  }
  await pipeline.exec()
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

  // We could run these in parallel, but if one fails we might want to rollback the other?
  // Ideally we use a single Lua script for both checks to be atomic across both limits, 
  // but for now let's do them sequentially or parallel and rollback if needed. 
  // Or just accept slight inconsistency (very rare).
  // Let's do sequential for safety to avoid over-reservation if one fails.

  // 1. Check/Reserve Minute Limit
  const minuteResult = await redis.eval(
    RESERVE_BUDGET,
    1,
    mKey,
    tokens,
    MINUTE_TTL_SECONDS,
    minuteLimit
  )

  if (Number(minuteResult) === -1) {
    return { allowed: false as const, reason: 'Minute token limit exceeded' }
  }

  // 2. Check/Reserve Daily Limit
  const dailyResult = await redis.eval(
    RESERVE_BUDGET,
    1,
    dKey,
    costCents,
    DAILY_TTL_SECONDS,
    dailyLimitCents
  )

  if (Number(dailyResult) === -1) {
    // Rollback minute reservation
    await redis.incrby(mKey, tokens)
    return { allowed: false as const, reason: 'Daily cost limit exceeded' }
  }

  return { allowed: true as const, remainingTokens: Number(minuteResult), remainingCost: Number(dailyResult) }
}
