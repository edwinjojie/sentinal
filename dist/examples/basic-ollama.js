"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const guard_1 = require("../src/core/guard");
const ollamaAdapter_1 = require("../src/providers/ollamaAdapter");
const provider = new ollamaAdapter_1.OllamaAdapter();
const guard = new guard_1.SentinalGuard(provider, {
    minuteTokenLimit: 1000,
    dailyCostLimitUSD: 1,
    blockOnViolation: true,
});
async function run() {
    const response = await guard.generate({
        subjectId: 'user-123',
        model: 'llama3',
        prompt: 'Explain quantum computing in simple terms.',
    });
    console.log(response.output);
}
run();
