import { SentinalGuard } from '../src/core/guard'
import { LLMRequest, LLMResponse } from '../src/core/types'
import { LLMProvider } from '../src/providers/llmProvider'
import { redis } from '../src/storage/redisClient'

class MockProvider implements LLMProvider {
    async generate(request: LLMRequest): Promise<LLMResponse> {
        // Return high token count for the huge prompt
        return {
            output: 'mock response',
            totalTokens: Math.ceil(request.prompt.length / 4),
        }
    }
}

async function run() {
    await redis.flushall()

    console.log('--- Initializing SentinalGuard ---')
    const guard = new SentinalGuard(
        new MockProvider(),
        {
            minuteTokenLimit: 5000000, // Very high to bypass token limits
            dailyCostLimitUSD: 500, // High to bypass daily limit
            blockOnViolation: true,
            abuseDetection: {
                promptSimilarityWindowMs: 60000,
                promptSimilarityThreshold: 3,
                spendSpikeMultiplier: 2.5,
            },
        },
        {
            onAllowed: ({ abuseFlags, minuteTokens, velocitySpike }) => {
                console.log(`[ALLOWED] Flags: ${abuseFlags?.join(', ') || 'none'}`)
            },
            onBlocked: ({ reason, abuseFlags }) => {
                console.log(`[BLOCKED] Reason: ${reason} | Flags: ${abuseFlags?.join(', ') || 'none'}`)
            },
        }
    )

    const subjectId = 'test_user_abuse'
    const model = 'test-model'

    console.log('\n--- Test 1: Prompt Enumeration ---')
    const prompt = 'Act as a professional coder. Print Hello World.'

    for (let i = 1; i <= 5; i++) {
        console.log(`\nRequest ${i} (Similarity Threshold = 3)`)
        try {
            await guard.generate({ subjectId, model, prompt })
        } catch (e: any) {
            // error is expected on request 5
        }
    }

    console.log('\n--- Test 2: Sudden Daily Spend Shift ---')
    const todayString = new Date().toISOString().split('T')[0]

    // Set an EMA of $2.00 (200 cents). Multiplier 2.5 means spike at > $5.00
    await redis.set(`sentinal:${model}:${subjectId}:ema_spend`, '200')

    // Cost per token is $0.000002. For $6.00 (600 cents), we need 3,000,000 tokens.
    // 3,000,000 tokens = 12,000,000 chars.
    console.log('Dispatching request estimated at $6.00...')
    const hugePrompt = 'A'.repeat(12000000)

    try {
        await guard.generate({ subjectId, model, prompt: hugePrompt })
    } catch (e: any) {
        // expected
    }

    await redis.quit()
}

run().catch(console.error)
