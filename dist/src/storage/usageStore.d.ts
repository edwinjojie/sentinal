export declare function getRemainingBudget(subjectId: string, model: string): Promise<{
    minuteRemaining: null;
    dailyRemaining: number | null;
}>;
export declare function adjustBudget(subjectId: string, model: string, tokenDelta: number, costCentsDelta: number): Promise<void>;
export declare function reserveBudget(subjectId: string, model: string, tokens: number, minuteLimit: number, costCents: number, dailyLimitCents: number): Promise<{
    allowed: true;
    remainingTokens: number;
    remainingCost: number;
    minuteTokens: number | null;
    rollingAvgTokens: number | null;
    velocitySpike: boolean;
    reason?: undefined;
} | {
    allowed: false;
    reason: string;
    remainingTokens?: undefined;
    remainingCost?: undefined;
    minuteTokens?: undefined;
    rollingAvgTokens?: undefined;
    velocitySpike?: undefined;
}>;
export declare function checkPromptSimilarity(subjectId: string, model: string, promptHash: string, windowMs: number, threshold: number): Promise<boolean>;
export declare function checkDailySpendSpike(subjectId: string, model: string, estimatedCostCents: number, multiplier: number): Promise<boolean>;
export declare function recordDailySpend(subjectId: string, model: string, costCents: number): Promise<void>;
export declare function incrementAbuseScore(subjectId: string, model: string, scoreDelta: number): Promise<number>;
export declare function incrementExhaustionCount(subjectId: string, model: string): Promise<number>;
