"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRemainingBudget = getRemainingBudget;
exports.adjustBudget = adjustBudget;
exports.reserveBudget = reserveBudget;
exports.checkPromptSimilarity = checkPromptSimilarity;
exports.checkDailySpendSpike = checkDailySpendSpike;
exports.recordDailySpend = recordDailySpend;
exports.incrementAbuseScore = incrementAbuseScore;
exports.incrementExhaustionCount = incrementExhaustionCount;
const redisClient_1 = require("./redisClient");
const scripts_1 = require("./scripts");
const MINUTE_TTL_SECONDS = 60;
const DAILY_TTL_SECONDS = 86400;
const VELOCITY_TTL_SECONDS = 600;
const VELOCITY_ALPHA = 0.2;
function minuteKey(subjectId, model) {
    return `sentinal:${model}:${subjectId}:minute`;
}
function dailyKey(subjectId, model) {
    return `sentinal:${model}:${subjectId}:daily_budget`;
}
function rollingAvgKey(subjectId, model) {
    return `sentinal:${model}:${subjectId}:rolling_avg`;
}
async function getRemainingBudget(subjectId, model) {
    const mKey = minuteKey(subjectId, model);
    const dKey = dailyKey(subjectId, model);
    const pipeline = redisClient_1.redis.pipeline();
    pipeline.get(mKey);
    pipeline.get(dKey);
    const results = await pipeline.exec();
    if (!results) {
        return {
            minuteRemaining: null,
            dailyRemaining: null,
        };
    }
    const dailyVal = results[1]?.[1] ?? null;
    return {
        minuteRemaining: null,
        dailyRemaining: dailyVal ? parseInt(dailyVal) : null,
    };
}
async function adjustBudget(subjectId, model, tokenDelta, costCentsDelta) {
    const mKey = minuteKey(subjectId, model);
    const dKey = dailyKey(subjectId, model);
    const pipeline = redisClient_1.redis.pipeline();
    if (tokenDelta !== 0) {
        const nonce = Math.random().toString(36).substring(7);
        const val = -tokenDelta;
        const member = `${val}:${nonce}`;
        const now = Date.now();
        pipeline.zadd(mKey, now, member);
        pipeline.expire(mKey, MINUTE_TTL_SECONDS);
    }
    if (costCentsDelta !== 0) {
        pipeline.incrby(dKey, costCentsDelta);
    }
    await pipeline.exec();
}
const LOCAL_CACHE_TTL_MS = 1000;
const localCache = new Map();
async function updateVelocity(subjectId, model, currentMinuteTokens) {
    const key = rollingAvgKey(subjectId, model);
    const old = await redisClient_1.redis.get(key);
    const oldAvg = old ? parseInt(old, 10) : 0;
    const velocitySpike = oldAvg > 0 && currentMinuteTokens > 3 * oldAvg;
    const baseline = oldAvg || currentMinuteTokens;
    const newAvg = Math.round(VELOCITY_ALPHA * currentMinuteTokens +
        (1 - VELOCITY_ALPHA) * baseline);
    await redisClient_1.redis.set(key, String(newAvg), 'EX', VELOCITY_TTL_SECONDS);
    return {
        rollingAvgTokens: newAvg,
        velocitySpike,
    };
}
async function reserveBudget(subjectId, model, tokens, minuteLimit, costCents, dailyLimitCents) {
    const mKey = minuteKey(subjectId, model);
    const dKey = dailyKey(subjectId, model);
    const now = Date.now();
    const cacheKey = `${model}:${subjectId}`;
    let entry = localCache.get(cacheKey);
    if (!entry) {
        entry = { availableTokens: 0, lastSync: 0 };
        localCache.set(cacheKey, entry);
    }
    if (entry.availableTokens >= tokens) {
        entry.availableTokens -= tokens;
        return {
            allowed: true,
            remainingTokens: 0,
            remainingCost: 0,
            minuteTokens: null,
            rollingAvgTokens: null,
            velocitySpike: false,
        };
    }
    const blockSize = Math.max(tokens, 50);
    const blockCostCents = Math.floor((blockSize / tokens) * costCents);
    const nonce = Math.random().toString(36).substring(7);
    const member = `${blockSize}:${nonce}`;
    const result = (await redisClient_1.redis.eval(scripts_1.RESERVE_UNIFIED, 2, mKey, dKey, now, MINUTE_TTL_SECONDS * 1000, minuteLimit, DAILY_TTL_SECONDS, dailyLimitCents, blockSize, blockCostCents, member));
    if (result[0] === -1) {
        return { allowed: false, reason: result[1] };
    }
    const reservedTokens = blockSize;
    const consumedTokens = tokens;
    entry.availableTokens = reservedTokens - consumedTokens;
    entry.lastSync = now;
    const minuteRemaining = result[1];
    const dailyRemaining = result[2];
    const currentMinuteTokens = result[3];
    const velocity = await updateVelocity(subjectId, model, currentMinuteTokens);
    return {
        allowed: true,
        remainingTokens: minuteRemaining,
        remainingCost: dailyRemaining,
        minuteTokens: currentMinuteTokens,
        rollingAvgTokens: velocity.rollingAvgTokens,
        velocitySpike: velocity.velocitySpike,
    };
}
async function checkPromptSimilarity(subjectId, model, promptHash, windowMs, threshold) {
    const key = `sentinal:${model}:${subjectId}:prompt_hashes`;
    const now = Date.now();
    const result = await redisClient_1.redis.eval(scripts_1.CHECK_PROMPT_SIMILARITY, 1, key, promptHash, now, windowMs, threshold);
    return result === 1;
}
async function checkDailySpendSpike(subjectId, model, estimatedCostCents, multiplier) {
    const todayString = new Date().toISOString().split('T')[0];
    const todayKey = `sentinal:${model}:${subjectId}:spend:${todayString}`;
    const emaKey = `sentinal:${model}:${subjectId}:ema_spend`;
    const result = await redisClient_1.redis.eval(scripts_1.CHECK_DAILY_SPEND_SPIKE, 2, todayKey, emaKey, multiplier, estimatedCostCents);
    return result === 1;
}
async function recordDailySpend(subjectId, model, costCents) {
    if (costCents === 0)
        return;
    const todayString = new Date().toISOString().split('T')[0];
    const todayKey = `sentinal:${model}:${subjectId}:spend:${todayString}`;
    const emaKey = `sentinal:${model}:${subjectId}:ema_spend`;
    const lastActiveDateKey = `sentinal:${model}:${subjectId}:last_active_date`;
    await redisClient_1.redis.eval(scripts_1.RECORD_DAILY_SPEND, 3, todayKey, emaKey, lastActiveDateKey, costCents, todayString);
}
async function incrementAbuseScore(subjectId, model, scoreDelta) {
    if (scoreDelta <= 0)
        return 0;
    const key = `sentinal:${model}:${subjectId}:abuse_score`;
    const ttl = 86400; // 24 hours
    const newScore = await redisClient_1.redis.eval(scripts_1.INCREMENT_ABUSE_SCORE, 1, key, scoreDelta, ttl);
    return newScore;
}
async function incrementExhaustionCount(subjectId, model) {
    const key = `sentinal:${model}:${subjectId}:exhaustion_count`;
    const ttl = 3600; // 1 hour window for repeated exhaustion checks
    const newCount = await redisClient_1.redis.eval(scripts_1.INCREMENT_EXHAUSTION_COUNT, 1, key, ttl);
    return newCount;
}
