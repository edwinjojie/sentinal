import { redis } from './redisClient'
import {
  RESERVE_BUDGET,
  RESERVE_SLIDING_WINDOW,
  RESERVE_UNIFIED,
  CHECK_PROMPT_SIMILARITY,
  ADD_PROMPT_SIGNATURE,
  CHECK_DAILY_SPEND_SPIKE,
  RECORD_DAILY_SPEND,
  INCREMENT_ABUSE_SCORE,
  INCREMENT_EXHAUSTION_COUNT,
  RECORD_TOKEN_DENSITY,
  ADD_GLOBAL_PROMPT_SIGNATURE,
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

import { calculateJaccardSimilarity } from '../utils/promptHash'

export async function checkPromptSimilarity(
  subjectId: string,
  model: string,
  promptSignature: number[],
  windowMs: number,
  threshold: number,
) {
  const key = `sentinal:${model}:${subjectId}:prompt_hashes`
  const now = Date.now()

  // 1. Get all recent signatures in the window
  const results = await redis.eval(
    CHECK_PROMPT_SIMILARITY,
    1,
    key,
    now,
    windowMs,
  ) as string[]

  let isSimilar = false
  let matchCount = 0

  if (results && results.length > 0) {
    for (const sigStr of results) {
      try {
        const sig = JSON.parse(sigStr) as number[]
        const similarity = calculateJaccardSimilarity(promptSignature, sig)

        // Jaccard similarity threshold for "same intent" is typically 0.8
        // We'll use 0.8 as a hardcoded similarity threshold for now, 
        // the 'threshold' parameter in the config was originally for count, 
        // but let's adapt it to mean "how many similar prompts to consider abuse"
        if (similarity >= 0.8) {
          matchCount++
          if (matchCount >= threshold) {
            isSimilar = true
            break
          }
        }
      } catch (e) {
        // Ignore invalid stored signatures
      }
    }
  }

  // 2. Add the current signature
  const nonce = Math.random().toString(36).substring(7)
  const signatureJSON = JSON.stringify(promptSignature)

  await redis.eval(
    ADD_PROMPT_SIGNATURE,
    1,
    key,
    signatureJSON,
    now,
    windowMs,
    nonce
  )

  return isSimilar
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

export async function recordTokenDensity(
  subjectId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  multiplier: number,
) {
  const emaKey = `sentinal:${model}:${subjectId}:token_density_ema`

  // Prevent division by zero, though inputTokens should typically be > 0
  const safeInputTokens = Math.max(1, inputTokens)
  const ratio = outputTokens / safeInputTokens

  const isAnomaly = await redis.eval(
    RECORD_TOKEN_DENSITY,
    1,
    emaKey,
    ratio,
    multiplier
  )

  return isAnomaly === 1
}
export async function checkGlobalPromptSimilarity(
  model: string,
  currentSubjectId: string,
  promptSignature: number[],
  windowMs: number,
  thresholdCount: number,
) {
  const key = `sentinal:global:${model}:prompt_hashes`
  const now = Date.now()
  const nonce = Math.random().toString(36).substring(7)
  const signatureJSON = JSON.stringify(promptSignature)

  // 1. Add current signature and return all valid signatures in window
  const results = await redis.eval(
    ADD_GLOBAL_PROMPT_SIGNATURE,
    1,
    key,
    signatureJSON,
    currentSubjectId,
    now,
    windowMs,
    nonce
  ) as string[]

  const matchedSubjects = new Set<string>()

  if (results && results.length > 0) {
    for (const item of results) {
      if (!item.includes('|')) continue

      const parts = item.split('|')
      if (parts.length < 2) continue

      const storedSigStr = parts[0]
      const storedSubjectId = parts[1]

      // Don't count the current subject against themselves for *global* correlation
      if (storedSubjectId === currentSubjectId) continue

      try {
        const storedSig = JSON.parse(storedSigStr) as number[]
        const similarity = calculateJaccardSimilarity(promptSignature, storedSig)

        if (similarity >= 0.8) {
          matchedSubjects.add(storedSubjectId)
          if (matchedSubjects.size >= thresholdCount) {
            return true
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }
  }

  return false
}
