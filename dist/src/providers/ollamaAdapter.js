"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaAdapter = void 0;
const tokenEstimator_1 = require("../utils/tokenEstimator");
class OllamaAdapter {
    async generate(request) {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: request.model,
                prompt: request.prompt,
                stream: false,
            }),
        });
        if (!response.ok) {
            throw new Error(`Ollama request failed: ${response.statusText}`);
        }
        const data = await response.json();
        const output = data.response;
        const totalTokens = (0, tokenEstimator_1.estimateTokens)(request.prompt) + (0, tokenEstimator_1.estimateTokens)(output);
        return {
            output,
            totalTokens,
        };
    }
}
exports.OllamaAdapter = OllamaAdapter;
exports.default = OllamaAdapter;
