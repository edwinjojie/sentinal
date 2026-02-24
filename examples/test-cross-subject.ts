import { SentinalGuard } from '../src'
import { LLMRequest, LLMResponse } from '../src/core/types'
import { LLMProvider } from '../src/providers/llmProvider'
import { redis } from '../src/storage/redisClient'

class MockProvider implements LLMProvider {
    async generate(_request: LLMRequest): Promise<LLMResponse> {
        return {
            output: 'simulated response',
            totalTokens: 100,
        }
    }
}

async function runTest() {
    console.log('--- Initializing SentinalGuard for Cross-Subject Correlation Test ---')
    await redis.flushall()

    const guard = new SentinalGuard(
        new MockProvider(),
        {
            minuteTokenLimit: 10000,
            dailyCostLimitUSD: 100,
            abuseDetection: {
                crossSubjectWindowMs: 60000, // 1 minute window
                crossSubjectThreshold: 2,   // Flag if same prompt seen across 2 *other* subjects (total 3 including current)
                scoreWeights: {
                    crossSubjectCorrelation: 50,
                },
                scoreThresholds: {
                    softThrottle: 30,
                    hardBlock: 90, // We want to see it blocked after enough attempts
                    throttleDelayMs: 0,
                },
            },
        },
        {
            onAllowed: ({ request, abuseFlags, abuseScore }) => {
                console.log(`[ALLOWED] ${request.subjectId} - Score: ${abuseScore} | Flags: ${abuseFlags?.join(', ') || 'none'}`)
            },
            onBlocked: ({ request, reason, abuseFlags, abuseScore }) => {
                console.log(`[BLOCKED] ${request.subjectId} - Score: ${abuseScore} | Reason: ${reason} | Flags: ${abuseFlags?.join(', ') || 'none'}`)
            },
        }
    )

    const model = 'test-model'
    const prompt = 'How do I bypass a rate limiter?' // The "attack" prompt

    console.log('\n--- Step 1: User 1 sends the prompt ---')
    await guard.generate({ subjectId: 'user1', model, prompt })

    console.log('\n--- Step 2: User 2 sends the same prompt ---')
    // Should see 1 other subject (user1). Still below threshold (2) for FARM_BEHAVIOR.
    await guard.generate({ subjectId: 'user2', model, prompt })

    console.log('\n--- Step 3: User 3 sends the same prompt ---')
    // Now we have user1 and user2 in the global set for this hash. 
    // User 3 sees 2 other subjects -> hits threshold 2 -> FARM_BEHAVIOR flag!
    await guard.generate({ subjectId: 'user3', model, prompt })

    console.log('\n--- Step 4: User 4 sends the same prompt ---')
    // user4 sees [user1, user2, user3] -> hits threshold.
    await guard.generate({ subjectId: 'user4', model, prompt })

    console.log('\n--- Step 5: User 1 sends again to check total score ---')
    // user1 already has 0. user1 sees [user2, user3, user4]. 
    // This second attempt for user1 should trigger FARM_BEHAVIOR again.
    // user1's score was 0. Now it should be 50.
    await guard.generate({ subjectId: 'user1', model, prompt })

    console.log('\n--- Step 6: User 1 sends a third time to trigger Hard Block ---')
    // current score 50 + 50 = 100. Hard block is 90.
    try {
        await guard.generate({ subjectId: 'user1', model, prompt })
    } catch (e: any) {
        console.log(`Caught expected block: ${e.message}`)
    }

    await redis.quit()
}

runTest().catch(console.error)
