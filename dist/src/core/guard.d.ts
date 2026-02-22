import { GuardConfig, GuardHooks, LLMRequest } from './types';
import { LLMProvider } from '../providers/llmProvider';
export declare class SentinalGuard {
    private provider;
    private config;
    private hooks?;
    private engine;
    constructor(provider: LLMProvider, config: GuardConfig, hooks?: GuardHooks);
    generate(request: LLMRequest): Promise<import("./types").LLMResponse>;
}
