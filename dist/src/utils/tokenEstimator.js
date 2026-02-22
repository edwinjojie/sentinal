"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simpleEstimator = exports.AdaptiveEstimator = exports.SimpleEstimator = void 0;
exports.estimateTokens = estimateTokens;
class SimpleEstimator {
    estimate(text) {
        return Math.ceil(text.length / 4);
    }
}
exports.SimpleEstimator = SimpleEstimator;
class AdaptiveEstimator {
    constructor() {
        // Model -> Multiplier (chars to tokens)
        // Default: 0.25 (1 token per 4 chars)
        this.multipliers = new Map();
        this.counts = new Map();
    }
    estimate(text, model = 'default') {
        const mult = this.multipliers.get(model) || 0.25;
        return Math.ceil(text.length * mult);
    }
    recordActual(prompt, actualTokens, model = 'default') {
        const currentMult = this.multipliers.get(model) || 0.25;
        const currentCount = this.counts.get(model) || 0;
        // Calculate observed multiplier for this request
        const observedMult = actualTokens / Math.max(1, prompt.length);
        // Update running average
        // NewAvg = (OldAvg * Count + NewObs) / (Count + 1)
        const newMult = (currentMult * currentCount + observedMult) / (currentCount + 1);
        this.multipliers.set(model, newMult);
        this.counts.set(model, currentCount + 1);
    }
}
exports.AdaptiveEstimator = AdaptiveEstimator;
const defaultEstimator = new AdaptiveEstimator();
exports.simpleEstimator = defaultEstimator;
function estimateTokens(text) {
    return defaultEstimator.estimate(text);
}
