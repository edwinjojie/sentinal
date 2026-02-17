import { LLMProvider } from './llmProvider'
import { LLMRequest, LLMResponse } from '../core/types'
import { estimateTokens } from '../utils/tokenEstimator'

export class OllamaAdapter implements LLMProvider {
  async generate(request: LLMRequest): Promise<LLMResponse> {
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
    })

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`)
    }

    const data = await response.json() as { response: string }
    const output: string = data.response
    const totalTokens = estimateTokens(request.prompt) + estimateTokens(output)

    return {
      output,
      totalTokens,
    }
  }
}

export default OllamaAdapter
