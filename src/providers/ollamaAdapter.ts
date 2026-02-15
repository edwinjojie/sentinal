import axios from 'axios'
import { LLMProvider } from './llmProvider'
import { LLMRequest, LLMResponse } from '../core/types'
import { estimateTokens } from '../utils/tokenEstimator'

export class OllamaAdapter implements LLMProvider {
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: request.model,
      prompt: request.prompt,
      stream: false,
    })

    const output: string = response.data.response
    const totalTokens = estimateTokens(request.prompt) + estimateTokens(output)

    return {
      output,
      totalTokens,
    }
  }
}

export default OllamaAdapter
