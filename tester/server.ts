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
    try {
        const keys = await redis.keys('sentinal:*');
        const stats: any = {
            global: {
                totalKeys: keys.length,
                activeSubjects: new Set(),
                totalRequests: 0, // Mock or derived if available
            },
            subjects: {} as Record<string, any>
        };

        for (const key of keys) {
            const val = await redis.get(key);
            const parts = key.split(':');

            // sentinal:model:subjectId:type
            if (parts.length >= 4) {
                const model = parts[1];
                const subjectId = parts[2];
                const type = parts.slice(3).join(':');

                stats.global.activeSubjects.add(subjectId);

                if (!stats.subjects[subjectId]) {
                    stats.subjects[subjectId] = { id: subjectId, models: {} };
                }
                if (!stats.subjects[subjectId].models[model]) {
                    stats.subjects[subjectId].models[model] = {};
                }

                // Parse known types
                if (type === 'abuse_score') stats.subjects[subjectId].models[model].abuseScore = parseInt(val || '0');
                else if (type === 'rolling_avg') stats.subjects[subjectId].models[model].rollingAvg = parseInt(val || '0');
                else if (type === 'daily_budget') stats.subjects[subjectId].models[model].dailySpend = parseInt(val || '0');
                else if (type === 'minute') {
                    // This is a sorted set in real usage, but let's check what redis.get returns or handle it
                    // In usageStore.ts, minuteKey is a ZSET. redis.get(key) will fail.
                    // However, server.ts uses redis.get(key). Let's fix this to be more robust.
                    try {
                        const typeInfo = await redis.type(key);
                        if (typeInfo === 'zset') {
                            stats.subjects[subjectId].models[model].minuteTokens = await redis.zcard(key);
                        } else {
                            stats.subjects[subjectId].models[model][type] = val;
                        }
                    } catch (e) { }
                }
                else {
                    stats.subjects[subjectId].models[model][type] = val;
                }
            }
        }

        stats.global.activeSubjects = stats.global.activeSubjects.size;
        res.json(stats);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reset', async (req, res) => {
    await redis.flushall();
    res.json({ status: 'reset' });
});

app.listen(port, () => {
    console.log(`Tester backend listening at http://localhost:${port}`);
});
