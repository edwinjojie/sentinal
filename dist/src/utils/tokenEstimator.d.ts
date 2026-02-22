import { TokenEstimator } from '../core/types';
export declare class SimpleEstimator implements TokenEstimator {
    estimate(text: string): number;
}
export declare class AdaptiveEstimator implements TokenEstimator {
    private multipliers;
    private counts;
    estimate(text: string, model?: string): number;
    recordActual(prompt: string, actualTokens: number, model?: string): void;
}
declare const defaultEstimator: AdaptiveEstimator;
export declare function estimateTokens(text: string): number;
export { defaultEstimator as simpleEstimator };
