import { LLMRequest, LLMResponse } from '../core/types';
export interface LLMProvider {
    generate(request: LLMRequest): Promise<LLMResponse>;
}
