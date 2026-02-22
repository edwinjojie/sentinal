"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const guard_1 = require("../src/core/guard");
const redisClient_1 = require("../src/storage/redisClient");
class MockProvider {
    async generate(request) {
        // Return high token count for the huge prompt
        return {
            output: 'mock response',
            totalTokens: Math.ceil(request.prompt.length / 4),
        };
    }
}
async function run() {
    await redisClient_1.redis.flushall();
    console.log('--- Initializing SentinalGuard ---');
    const guard = new guard_1.SentinalGuard(new MockProvider(), {
        minuteTokenLimit: 5000000, // Very high to bypass token limits
        dailyCostLimitUSD: 500, // High to bypass daily limit
        blockOnViolation: true,
        abuseDetection: {
            promptSimilarityWindowMs: 60000,
            promptSimilarityThreshold: 3,
            spendSpikeMultiplier: 2.5,
        },
    }, {
        onAllowed: ({ abuseFlags, minuteTokens, velocitySpike }) => {
            console.log(`[ALLOWED] Flags: ${abuseFlags?.join(', ') || 'none'}`);
        },
        onBlocked: ({ reason, abuseFlags }) => {
            console.log(`[BLOCKED] Reason: ${reason} | Flags: ${abuseFlags?.join(', ') || 'none'}`);
        },
    });
    const subjectId = 'test_user_abuse';
    const model = 'test-model';
    console.log('\n--- Test 1: Prompt Enumeration ---');
    const prompt = 'Act as a professional coder. Print Hello World.';
    for (let i = 1; i <= 5; i++) {
        console.log(`\nRequest ${i} (Similarity Threshold = 3)`);
        try {
            await guard.generate({ subjectId, model, prompt });
        }
        catch (e) {
            // error is expected on request 5
        }
    }
    console.log('\n--- Test 2: Sudden Daily Spend Shift ---');
    const todayString = new Date().toISOString().split('T')[0];
    // Set an EMA of $2.00 (200 cents). Multiplier 2.5 means spike at > $5.00
    await redisClient_1.redis.set(`sentinal:${model}:${subjectId}:ema_spend`, '200');
    // Cost per token is $0.000002. For $6.00 (600 cents), we need 3,000,000 tokens.
    // 3,000,000 tokens = 12,000,000 chars.
    console.log('Dispatching request estimated at $6.00...');
    const hugePrompt = 'A'.repeat(12000000);
    try {
        await guard.generate({ subjectId, model, prompt: hugePrompt });
    }
    catch (e) {
        // expected
    }
    await redisClient_1.redis.quit();
}
run().catch(console.error);
