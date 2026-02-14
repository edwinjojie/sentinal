import { OllamaAdapter } from '../src/providers/ollamaAdapter'
import { LLMRequest } from '../src/core/types'

async function main() {
  const provider = new OllamaAdapter('llama3')
  const req: LLMRequest = { subjectId: 'demo', model: 'llama3', prompt: 'Say hello' }
  try {
    const res = await provider.generate(req)
    console.log(res)
  } catch (e) {
    console.error(String(e))
  }
}

main()
