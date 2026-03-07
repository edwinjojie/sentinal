import express from 'express';
import cors from 'cors';
import { SentinalGuard } from '../src/core/guard';
import { LLMRequest, LLMResponse } from '../src/core/types';
import { LLMProvider } from '../src/providers/llmProvider';
import { redis } from '../src/storage/redisClient';

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// Handle Redis connection errors
redis.on('error', (err) => {
    console.error('[SENTINAL] Redis connection error:', err.message);
    console.warn('[SENTINAL] Please ensure Redis is running on localhost:6379');
});

class MockProvider implements LLMProvider {
    async generate(request: LLMRequest): Promise<LLMResponse> {
        // Simple mock response logic
        const tokenCount = Math.ceil((request.prompt?.length || 0) / 4) + 10;
        return {
            output: `This is a mock response for the prompt: "${request.prompt?.substring(0, 50)}..."`,
            totalTokens: tokenCount,
        };
    }
}

let guardConfig: any = {
    minuteTokenLimit: 1000,
    dailyCostLimitUSD: 10,
    blockOnViolation: true,
    abuseDetection: {
        promptSimilarityWindowMs: 60000,
        promptSimilarityThreshold: 3,
        spendSpikeMultiplier: 2.5,
    },
};

let guard = new SentinalGuard(new MockProvider(), guardConfig, {
    onAllowed: (data) => console.log('[SENTINAL] Allowed:', data),
    onBlocked: (data) => console.log('[SENTINAL] Blocked:', data),
});

app.get('/api/config', (req, res) => {
    res.json(guardConfig);
});

app.post('/api/config', (req, res) => {
    guardConfig = { ...guardConfig, ...req.body };
    guard = new SentinalGuard(new MockProvider(), guardConfig, {
        onAllowed: (data) => console.log('[SENTINAL] Allowed:', data),
        onBlocked: (data) => console.log('[SENTINAL] Blocked:', data),
    });
    res.json({ status: 'updated', config: guardConfig });
});

app.post('/api/test', async (req, res) => {
    const { subjectId, prompt, model = 'test-model' } = req.body;

    try {
        const response = await guard.generate({ subjectId, model, prompt });
        res.json({ status: 'allowed', response });
    } catch (error: any) {
        res.status(403).json({
            status: 'blocked',
            reason: error.message,
            details: error.details || {}
        });
    }
});

app.get('/api/stats', async (req, res) => {
    const keys = await redis.keys('sentinal:*');
    const stats: any = {};
    for (const key of keys) {
        const val = await redis.get(key);
        stats[key] = val;
    }
    res.json(stats);
});

app.post('/api/reset', async (req, res) => {
    await redis.flushall();
    res.json({ status: 'reset' });
});

app.listen(port, () => {
    console.log(`Tester backend listening at http://localhost:${port}`);
});
