import { GuardConfig, LLMRequest, LLMResponse, TokenEstimator } from './types';
export interface EnforcementResult {
    allowed: boolean;
    reason?: string;
    estimatedTokens: number;
    estimatedCostCents: number;
    minuteTokens?: number | null;
    rollingAvgTokens?: number | null;
    velocitySpike?: boolean;
    abuseFlags?: string[];
    abuseScore?: number;
    softThrottled?: boolean;
}
export interface EnforcementEngineOptions {
    estimator: TokenEstimator;
}
export declare class EnforcementEngine {
    private estimator;
    constructor(options: EnforcementEngineOptions);
    reserve(request: LLMRequest, config: GuardConfig): Promise<EnforcementResult>;
    commit(request: LLMRequest, response: LLMResponse, estimatedTokens: number, estimatedCostCents: number): Promise<void>;
}
