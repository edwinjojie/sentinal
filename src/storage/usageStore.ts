import { redis } from './redisClient'

export async function incrementMinuteTokens(subjectId: string, tokens: number) {
  const key = `sentinal:minute:${subjectId}`
  await redis.incrby(key, tokens)
  await redis.expire(key, 60)
}

export async function getMinuteTokens(subjectId: string) {
  const key = `sentinal:minute:${subjectId}`
  const val = await redis.get(key)
  return parseInt(val || '0')
}

export async function incrementDailyCost(subjectId: string, cost: number) {
  const key = `sentinal:daily:${subjectId}`
  await redis.incrbyfloat(key, cost)
  await redis.expire(key, 86400)
}

export async function getDailyCost(subjectId: string) {
  const key = `sentinal:daily:${subjectId}`
  const val = await redis.get(key)
  return parseFloat(val || '0')
}
