import { SentinalGuard } from '../src/core/guard'
import { OllamaAdapter } from '../src/providers/ollamaAdapter'

const provider = new OllamaAdapter()

const guard = new SentinalGuard(provider, {
  minuteTokenLimit: 1000,
  dailyCostLimitUSD: 1,
  blockOnViolation: true,
})

async function run() {
  const response = await guard.generate({
    subjectId: 'user-123',
    model: 'llama3',
    prompt: 'Explain quantum computing in simple terms.',
  })

  console.log(response.output)
}

run()
