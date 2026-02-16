import { redis } from '../src/storage/redisClient'
import { reserveBudget, adjustBudget, getRemainingBudget } from '../src/storage/usageStore'

async function run() {
    const subjectId = 'test-user-1'
    const MINUTE_LIMIT = 100
    const DAILY_LIMIT_CENTS = 500 // $5.00

    console.log('Clearing keys...')
    await redis.del(`sentinal:sliding:minute:${subjectId}`)
    await redis.del(`sentinal:budget:daily:${subjectId}`)

    console.log('--- Test 1: Reserve 50 tokens (Limit 100) ---')
    const res1 = await reserveBudget(subjectId, 50, MINUTE_LIMIT, 50, DAILY_LIMIT_CENTS)
    console.log('Res1:', res1)

    // Note: First call might initialize with Limit, then decrement.
    // Code: current = limit (100). new = decrby(100, 50) = 50.
    // So returning 50 is correct.
    if (!res1.allowed) throw new Error('Test 1 failed')
    if (res1.remainingTokens !== 50) throw new Error(`Expected 50 remaining, got ${res1.remainingTokens}`)

    console.log('--- Test 2: Adjust +10 tokens (Refund 10, usage was 40) ---')
    // We reserved 50. Actual usage 40. Delta = 50 - 40 = 10.
    await adjustBudget(subjectId, 10, 10)
    await new Promise(r => setTimeout(r, 100)) // give redis a moment (pipeline)
    const budget2 = await getRemainingBudget(subjectId)
    console.log('Budget after adjust:', budget2)
    if (budget2.minuteRemaining !== 60) throw new Error(`Expected 60 remaining, got ${budget2.minuteRemaining}`)

    console.log('--- Test 3: Reserve 70 tokens (Limit 100, Remaining 60) ---')
    const res3 = await reserveBudget(subjectId, 70, MINUTE_LIMIT, 70, DAILY_LIMIT_CENTS)
    console.log('Res3:', res3)
    if (res3.allowed) throw new Error('Test 3 failed (should be denied)')

    console.log('--- Test 4: Reserve 60 tokens (Exact remaining) ---')
    const res4 = await reserveBudget(subjectId, 60, MINUTE_LIMIT, 60, DAILY_LIMIT_CENTS)
    console.log('Res4:', res4)
    if (!res4.allowed) throw new Error('Test 4 failed')
    if (res4.remainingTokens !== 0) throw new Error(`Expected 0 remaining, got ${res4.remainingTokens}`)

    console.log('ALL TESTS PASSED')
    process.exit(0)
}

run().catch(console.error)
