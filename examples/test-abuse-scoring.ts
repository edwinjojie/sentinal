import { SentinalGuard } from '../src/core/guard'
import { LLMRequest, LLMResponse } from '../src/core/types'
import { LLMProvider } from '../src/providers/llmProvider'
import { redis } from '../src/storage/redisClient'

class MockProvider implements LLMProvider {
    async generate(request: LLMRequest): Promise<LLMResponse> {
        return {
            output: 'mock response',
            totalTokens: Math.ceil(request.prompt.length / 4),
        }
    }
}

async function run() {
    await redis.flushall()

    console.log('--- Initializing SentinalGuard with Scoring & Soft Throttling ---')
    const guard = new SentinalGuard(
        new MockProvider(),
        {
            minuteTokenLimit: 5000000,
            dailyCostLimitUSD: 500,
            blockOnViolation: true,
            abuseDetection: {
                promptSimilarityWindowMs: 60000,
                promptSimilarityThreshold: 2,
                spendSpikeMultiplier: 2.5,
                scoreWeights: {
                    velocitySpike: 20,
                    promptRepetition: 15,
                    spendSpike: 30,
                    budgetExhaustion: 10
                },
                scoreThresholds: {
                    softThrottle: 50,
                    hardBlock: 80,
                    throttleDelayMs: 1000,
                    exhaustionTriggerCount: 3
                }
            },
        },
        {
            onAllowed: ({ abuseFlags, abuseScore, softThrottled }) => {
                console.log(`[ALLOWED] Flags: ${abuseFlags?.join(', ') || 'none'} | Score: ${abuseScore || 0} | Throttled: ${softThrottled}`)
            },
            onBlocked: ({ reason, abuseFlags, abuseScore }) => {
                console.log(`[BLOCKED] Reason: ${reason} | Flags: ${abuseFlags?.join(', ') || 'none'} | Score: ${abuseScore || 0}`)
            },
        }
    )

    const subjectId = 'score_test_user'
    const model = 'test-model'

    console.log('\n--- Test: Accumulating Score via Prompt Enumeration ---')
    const prompt = 'Act like a human.'

    for (let i = 1; i <= 6; i++) {
        console.log(`\nRequest ${i} Phase:`)
        const t0 = Date.now()
        try {
            await guard.generate({ subjectId, model, prompt })
        } catch (e: any) {
            console.log(`Caught Error: ${e.message}`)
        }
        const duration = Date.now() - t0
        console.log(`Duration: ${duration}ms`)
    }

    await redis.quit()
}

run().catch(console.error)
