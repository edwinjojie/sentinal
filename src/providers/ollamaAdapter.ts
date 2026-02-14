import { LLMRequest, LLMResponse } from '../core/types'
import { LLMProvider } from './llmProvider'

export class OllamaAdapter implements LLMProvider {
  private model: string

  constructor(model: string) {
    this.model = model
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    throw new Error('OllamaAdapter not implemented')
  }
}

export default OllamaAdapter
