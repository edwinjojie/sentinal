import { redis } from './redisClient'
import {
  RESERVE_BUDGET,
  RESERVE_SLIDING_WINDOW,
  RESERVE_UNIFIED,
  CHECK_PROMPT_SIMILARITY,
  CHECK_DAILY_SPEND_SPIKE,
  RECORD_DAILY_SPEND,
  INCREMENT_ABUSE_SCORE,
  INCREMENT_EXHAUSTION_COUNT,
} from './scripts'

const MINUTE_TTL_SECONDS = 60
const DAILY_TTL_SECONDS = 86400
const VELOCITY_TTL_SECONDS = 600
const VELOCITY_ALPHA = 0.2

function minuteKey(subjectId: string, model: string): string {
  return `sentinal:${model}:${subjectId}:minute`
}

function dailyKey(subjectId: string, model: string): string {
  return `sentinal:${model}:${subjectId}:daily_budget`
}

function rollingAvgKey(subjectId: string, model: string): string {
  return `sentinal:${model}:${subjectId}:rolling_avg`
}

export async function getRemainingBudget(subjectId: string, model: string) {
  const mKey = minuteKey(subjectId, model)
  const dKey = dailyKey(subjectId, model)

  const pipeline = redis.pipeline()
  pipeline.get(mKey)
  pipeline.get(dKey)
  const results = await pipeline.exec()

  if (!results) {
    return {
      minuteRemaining: null,
      dailyRemaining: null,
    }
  }

  const dailyVal = (results[1]?.[1] as string | null) ?? null

  return {
    minuteRemaining: null,
    dailyRemaining: dailyVal ? parseInt(dailyVal) : null,
  }
}

export async function adjustBudget(
  subjectId: string,
  model: string,
  tokenDelta: number,
  costCentsDelta: number,
) {
  const mKey = minuteKey(subjectId, model)
  const dKey = dailyKey(subjectId, model)

  const pipeline = redis.pipeline()

  if (tokenDelta !== 0) {
    const nonce = Math.random().toString(36).substring(7)
    const val = -tokenDelta
    const member = `${val}:${nonce}`
    const now = Date.now()
    pipeline.zadd(mKey, now, member)
    pipeline.expire(mKey, MINUTE_TTL_SECONDS)
  }

  if (costCentsDelta !== 0) {
    pipeline.incrby(dKey, costCentsDelta)
  }
  await pipeline.exec()
}

const LOCAL_CACHE_TTL_MS = 1000

interface LocalCacheEntry {
  availableTokens: number
  lastSync: number
}

const localCache = new Map<string, LocalCacheEntry>()

async function updateVelocity(
  subjectId: string,
  model: string,
  currentMinuteTokens: number,
) {
  const key = rollingAvgKey(subjectId, model)
  const old = await redis.get(key)
  const oldAvg = old ? parseInt(old, 10) : 0
  const velocitySpike =
    oldAvg > 0 && currentMinuteTokens > 3 * oldAvg

  const baseline = oldAvg || currentMinuteTokens
  const newAvg = Math.round(
    VELOCITY_ALPHA * currentMinuteTokens +
    (1 - VELOCITY_ALPHA) * baseline,
  )

  await redis.set(
    key,
    String(newAvg),
    'EX',
    VELOCITY_TTL_SECONDS,
  )

  return {
    rollingAvgTokens: newAvg,
    velocitySpike,
  }
}

export async function reserveBudget(
  subjectId: string,
  model: string,
  tokens: number,
  minuteLimit: number,
  costCents: number,
  dailyLimitCents: number,
) {
  const mKey = minuteKey(subjectId, model)
  const dKey = dailyKey(subjectId, model)
  const now = Date.now()

  const cacheKey = `${model}:${subjectId}`
  let entry = localCache.get(cacheKey)
  if (!entry) {
    entry = { availableTokens: 0, lastSync: 0 }
    localCache.set(cacheKey, entry)
  }

  if (entry.availableTokens >= tokens) {
    entry.availableTokens -= tokens

    return {
      allowed: true as const,
      remainingTokens: 0,
      remainingCost: 0,
      minuteTokens: null as number | null,
      rollingAvgTokens: null as number | null,
      velocitySpike: false,
    }
  }

  const blockSize = Math.max(tokens, 50)
  const blockCostCents = Math.floor((blockSize / tokens) * costCents)

  const nonce = Math.random().toString(36).substring(7)
  const member = `${blockSize}:${nonce}`

  const result = (await redis.eval(
    RESERVE_UNIFIED,
    2,
    mKey,
    dKey,
    now,
    MINUTE_TTL_SECONDS * 1000,
    minuteLimit,
    DAILY_TTL_SECONDS,
    dailyLimitCents,
    blockSize,
    blockCostCents,
    member,
  )) as [number, number, number, number] | [number, string]

  if (result[0] === -1) {
    return { allowed: false as const, reason: result[1] as string }
  }

  const reservedTokens = blockSize
  const consumedTokens = tokens

  entry.availableTokens = reservedTokens - consumedTokens
  entry.lastSync = now

  const minuteRemaining = result[1] as number
  const dailyRemaining = result[2] as number
  const currentMinuteTokens = result[3] as number

  const velocity = await updateVelocity(
    subjectId,
    model,
    currentMinuteTokens,
  )

  return {
    allowed: true as const,
    remainingTokens: minuteRemaining,
    remainingCost: dailyRemaining,
    minuteTokens: currentMinuteTokens,
    rollingAvgTokens: velocity.rollingAvgTokens,
    velocitySpike: velocity.velocitySpike,
  }
}

export async function checkPromptSimilarity(
  subjectId: string,
  model: string,
  promptHash: string,
  windowMs: number,
  threshold: number,
) {
  const key = `sentinal:${model}:${subjectId}:prompt_hashes`
  const now = Date.now()

  const result = await redis.eval(
    CHECK_PROMPT_SIMILARITY,
    1,
    key,
    promptHash,
    now,
    windowMs,
    threshold,
  )

  return result === 1
}

export async function checkDailySpendSpike(
  subjectId: string,
  model: string,
  estimatedCostCents: number,
  multiplier: number,
) {
  const todayString = new Date().toISOString().split('T')[0]
  const todayKey = `sentinal:${model}:${subjectId}:spend:${todayString}`
  const emaKey = `sentinal:${model}:${subjectId}:ema_spend`

  const result = await redis.eval(
    CHECK_DAILY_SPEND_SPIKE,
    2,
    todayKey,
    emaKey,
    multiplier,
    estimatedCostCents,
  )

  return result === 1
}

export async function recordDailySpend(
  subjectId: string,
  model: string,
  costCents: number,
) {
  if (costCents === 0) return

  const todayString = new Date().toISOString().split('T')[0]
  const todayKey = `sentinal:${model}:${subjectId}:spend:${todayString}`
  const emaKey = `sentinal:${model}:${subjectId}:ema_spend`
  const lastActiveDateKey = `sentinal:${model}:${subjectId}:last_active_date`

  await redis.eval(
    RECORD_DAILY_SPEND,
    3,
    todayKey,
    emaKey,
    lastActiveDateKey,
    costCents,
    todayString,
  )
}

export async function incrementAbuseScore(
  subjectId: string,
  model: string,
  scoreDelta: number,
) {
  if (scoreDelta <= 0) return 0

  const key = `sentinal:${model}:${subjectId}:abuse_score`
  const ttl = 86400 // 24 hours

  const newScore = await redis.eval(
    INCREMENT_ABUSE_SCORE,
    1,
    key,
    scoreDelta,
    ttl,
  )

  return newScore as number
}

export async function incrementExhaustionCount(
  subjectId: string,
  model: string,
) {
  const key = `sentinal:${model}:${subjectId}:exhaustion_count`
  const ttl = 3600 // 1 hour window for repeated exhaustion checks

  const newCount = await redis.eval(
    INCREMENT_EXHAUSTION_COUNT,
    1,
    key,
    ttl,
  )

  return newCount as number
}
