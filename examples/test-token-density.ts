import { SentinalGuard } from '../src'
import { LLMRequest, LLMResponse } from '../src/core/types'
import { LLMProvider } from '../src/providers/llmProvider'
import { redis } from '../src/storage/redisClient'

// A mock provider that simulates long responses for short prompts
class DensityTestProvider implements LLMProvider {
    async generate(request: LLMRequest): Promise<LLMResponse> {
        // Determine token counts for our test logic
        // We expect output to be very high for short inputs in the attack scenario
        let outputTokens = 10;

        // Simulate an extract/fishing attack: very short prompt -> huge output
        if (request.prompt === 'extract') {
            outputTokens = 2000;
        }

        return {
            output: 'simulated response',
            totalTokens: request.prompt.length + outputTokens, // approximate total
        }
    }
}

async function runTest() {
    await redis.flushall()

    console.log('--- Initializing SentinalGuard for Token Density Anomaly Test ---')
    const guard = new SentinalGuard(
        new DensityTestProvider(),
        {
            minuteTokenLimit: 100000,
            dailyCostLimitUSD: 100,
            blockOnViolation: true,
            abuseDetection: {
                tokenDensityMultiplier: 3.0, // Flag if density is 3x the normal EMA
                scoreWeights: {
                    tokenDensityAnomaly: 50, // High score per anomaly
                },
                scoreThresholds: {
                    softThrottle: 30,
                    hardBlock: 100,
                    throttleDelayMs: 1000,
                },
            },
        },
        {
            onAllowed: ({ abuseFlags, abuseScore }) => {
                console.log(`[ALLOWED] Score: ${abuseScore} | Flags: ${abuseFlags?.join(', ') || 'none'}`)
            },
            onBlocked: ({ reason, abuseFlags, abuseScore }) => {
                console.log(`[BLOCKED] Score: ${abuseScore} | Reason: ${reason} | Flags: ${abuseFlags?.join(', ') || 'none'}`)
            },
        }
    )

    const subjectId = 'test_density_user'
    const model = 'test-model'

    console.log('\n--- Establishing Baseline ---')
    console.log('Sending normal requests to establish normal density (~1 output / input)...')

    // Normal requests where lengths roughly match
    const longPrompt = 'This is a normal sized prompt that we will use to establish a baseline token density.'

    for (let i = 1; i <= 3; i++) {
        await guard.generate({ subjectId, model, prompt: longPrompt })
    }

    // Check current EMA manually
    const emaKey = `sentinal:${model}:${subjectId}:token_density_ema`;
    const emaStr = await redis.get(emaKey)
    console.log(`Current Token Density EMA: ${emaStr}`)

    console.log('\n--- Test: Token Density Anomaly Attack ---')
    console.log('Sending short prompt aiming for massive output (fishing attack)...')

    try {
        // First attack should spike the ratio and trigger the anomaly logic + give 50 points
        await guard.generate({ subjectId, model, prompt: 'extract' })

        // The second attack should get us to 100 points, triggering a Hard Block
        console.log('\nSending second attack...')
        await guard.generate({ subjectId, model, prompt: 'extract' })

        // The third attack shouldn't process.
        console.log('\nSending third attack...')
        await guard.generate({ subjectId, model, prompt: 'extract' })
    } catch (e: any) {
        console.log(`Expected Block Exception Caught: ${e.message}`)
    }

    const finalScore = await redis.get(`sentinal:${model}:${subjectId}:abuse_score`)
    console.log(`\nFinal Abuse Score: ${finalScore} (Expected >= 100)`)

    await redis.quit()
}

runTest().catch(console.error)
