"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const guard_1 = require("../src/core/guard");
const redisClient_1 = require("../src/storage/redisClient");
class MockProvider {
    async generate(request) {
        return {
            output: 'mock response',
            totalTokens: Math.ceil(request.prompt.length / 4),
        };
    }
}
async function run() {
    await redisClient_1.redis.flushall();
    console.log('--- Initializing SentinalGuard with Scoring & Soft Throttling ---');
    const guard = new guard_1.SentinalGuard(new MockProvider(), {
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
    }, {
        onAllowed: ({ abuseFlags, abuseScore, softThrottled }) => {
            console.log(`[ALLOWED] Flags: ${abuseFlags?.join(', ') || 'none'} | Score: ${abuseScore || 0} | Throttled: ${softThrottled}`);
        },
        onBlocked: ({ reason, abuseFlags, abuseScore }) => {
            console.log(`[BLOCKED] Reason: ${reason} | Flags: ${abuseFlags?.join(', ') || 'none'} | Score: ${abuseScore || 0}`);
        },
    });
    const subjectId = 'score_test_user';
    const model = 'test-model';
    console.log('\n--- Test: Accumulating Score via Prompt Enumeration ---');
    const prompt = 'Act like a human.';
    for (let i = 1; i <= 6; i++) {
        console.log(`\nRequest ${i} Phase:`);
        const t0 = Date.now();
        try {
            await guard.generate({ subjectId, model, prompt });
        }
        catch (e) {
            console.log(`Caught Error: ${e.message}`);
        }
        const duration = Date.now() - t0;
        console.log(`Duration: ${duration}ms`);
    }
    await redisClient_1.redis.quit();
}
run().catch(console.error);
