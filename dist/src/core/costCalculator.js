"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COST_PER_TOKEN = exports.PRICE_PER_1K_TOKENS = void 0;
exports.calculateCost = calculateCost;
exports.costToCents = costToCents;
exports.PRICE_PER_1K_TOKENS = 0.002;
// Precompute cost per token to avoid division at runtime
// 0.002 / 1000 = 0.000002
exports.COST_PER_TOKEN = exports.PRICE_PER_1K_TOKENS / 1000;
function calculateCost(tokens) {
    return tokens * exports.COST_PER_TOKEN;
}
function costToCents(cost) {
    return Math.round(cost * 100);
}
