"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SentinalGuard = void 0;
const enforcementEngine_1 = require("./enforcementEngine");
const tokenEstimator_1 = require("../utils/tokenEstimator");
const errors_1 = require("./errors");
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
class SentinalGuard {
    constructor(provider, config, hooks) {
        if (config.minuteTokenLimit <= 0) {
            throw new Error('Invalid minuteTokenLimit');
        }
        if (config.dailyCostLimitUSD <= 0) {
            throw new Error('Invalid dailyCostLimitUSD');
        }
        this.provider = provider;
        this.config = config;
        this.hooks = hooks;
        this.engine = new enforcementEngine_1.EnforcementEngine({ estimator: tokenEstimator_1.simpleEstimator });
    }
    async generate(request) {
        const baseContext = {
            request,
            config: this.config,
        };
        try {
            const result = await this.engine.reserve(request, this.config);
            let reservedTokens = 0;
            let reservedCostCents = 0;
            if (!result.allowed && this.config.blockOnViolation) {
                const error = new errors_1.LimitExceededError(result.reason || 'Limit exceeded');
                if (this.hooks?.onBlocked) {
                    await this.hooks.onBlocked({
                        ...baseContext,
                        reason: result.reason,
                        error,
                        abuseFlags: result.abuseFlags,
                        abuseScore: result.abuseScore,
                        softThrottled: result.softThrottled,
                    });
                }
                throw error;
            }
            // If allowed, we reserved the estimated amount.
            // If not allowed (but proceeding due to !blockOnViolation), we reserved 0.
            if (result.allowed) {
                reservedTokens = result.estimatedTokens;
                reservedCostCents = result.estimatedCostCents;
                if (result.softThrottled && this.config.abuseDetection?.scoreThresholds) {
                    const sleepMs = this.config.abuseDetection.scoreThresholds.throttleDelayMs || 1000;
                    await delay(sleepMs);
                }
            }
            const response = await this.provider.generate(request);
            await this.engine.commit(request, response, reservedTokens, reservedCostCents);
            if (this.hooks?.onAllowed) {
                await this.hooks.onAllowed({
                    ...baseContext,
                    minuteTokens: result.minuteTokens ?? null,
                    rollingAvgTokens: result.rollingAvgTokens ?? null,
                    velocitySpike: result.velocitySpike ?? false,
                    abuseFlags: result.abuseFlags,
                    abuseScore: result.abuseScore,
                    softThrottled: result.softThrottled,
                    response,
                });
            }
            return response;
        }
        catch (err) {
            if (err instanceof errors_1.LimitExceededError) {
                // Already handled explicitly above if expected. 
                // But if for some reason it bubbles up (shouldn't), rethrow.
                throw err;
            }
            if (this.hooks?.onError) {
                await this.hooks.onError({
                    ...baseContext,
                    error: err,
                });
            }
            throw err;
        }
    }
}
exports.SentinalGuard = SentinalGuard;
