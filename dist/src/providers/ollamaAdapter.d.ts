import { LLMProvider } from './llmProvider';
import { LLMRequest, LLMResponse } from '../core/types';
export declare class OllamaAdapter implements LLMProvider {
    generate(request: LLMRequest): Promise<LLMResponse>;
}
export default OllamaAdapter;
