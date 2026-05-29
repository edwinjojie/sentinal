# Sentinal

**Sentinal** is a high-performance, distributed, Redis-backed rate limiting, cost tracking, and abuse mitigation guardrail system designed specifically for AI and LLM (Large Language Model) applications. 

It acts as an intelligent proxy/guard between your users and upstream LLM providers (e.g., OpenAI, Anthropic, Ollama), protecting your APIs from runaway token costs, prompt-injection attacks, sybil/farm scraping behavior, and malicious resource exhaustion.

---

## 💡 The Core Concept: Pessimistic Reservation & Optimistic Commit

Standard API rate limiters operate on simple request counts. However, LLMs are billed and constrained by **tokens** and **cost**, which are highly variable and unknown until *after* the model finishes generating a response. 

To prevent race conditions, budget overruns, and database-level lockups in distributed systems, Sentinal uses a **Pessimistic Reservation and Optimistic Commit** workflow:

```
 User Request       +-------------------+       LLM API Calls       +--------------------+
 ------------->[1]  |                   |  ===================>[4]  |                    |
                    |   SentinalGuard   |                           |  Upstream Provider |
 <-------------[6]  |                   |  <===================[5]  |    (Ollama/OAI)    |
   LLM Response     +---------+---------+     Actual Token Usage    +--------------------+
                              |
                     [2] Read | [3] Reserve
                              | [5a] Commit Delta
                              v
                    +-------------------+
                    |    Redis Store    |
                    | (Lua Scripting)   |
                    +-------------------+
```

### The Request Lifecycle
1. **Estimate**: Sentinal analyzes the incoming prompt to dynamically estimate token usage and calculate the maximum potential cost (e.g., using `AdaptiveEstimator`).
2. **Pessimistic Reservation**: An atomic Lua script (`RESERVE_UNIFIED`) runs in Redis to verify if the estimated cost/tokens fit within the user's minute sliding window and daily cost limits. If allowed, it *pessimistically reserves* the estimated capacity.
3. **Abuse Scoring & Mitigation**: Sentinal evaluates multiple threat vectors (repetition, velocity, spend spikes). If threats are detected:
   - **Soft Throttle**: Artificially delays the request (`throttleDelayMs`) to slow down malicious scripts.
   - **Hard Block**: Blocks the request immediately, preserving upstream LLM resources.
4. **Execution**: The request is dispatched to the upstream LLM (e.g., Ollama, OpenAI).
5. **Optimistic Commit**: Once the LLM responds, Sentinal measures the actual token count and cost. It commits the exact usage and rollbacks/releases any over-reserved tokens/budget.

---

## 🛠️ Tech Stack

- **Runtime**: TypeScript & Node.js
- **Distributed Database**: Redis (uses sorted sets `ZSET` for sliding-window rate limiting, fast key-value pairs for metrics/EMAs, and customized atomic Lua scripts).
- **LLM Integrations**: Modular LLM adapters (comes with an `OllamaAdapter` out of the box).
- **Dashboard & Simulation Client**: Express.js server + Vite frontend.

---

## 🧠 Advanced Abuse Detection Engine

Sentinal doesn't just block users when they hit a limit; it continuously monitors their behavioral patterns to detect and score potential abuse.

| Abuse Flag | Description | Implementation Details |
| :--- | :--- | :--- |
| **`VELOCITY_SPIKE`** | Detects sudden, anomalous surges in token consumption. | Compares the user's current minute usage against an Exponential Moving Average (EMA) baseline. Triggered if current usage exceeds 3x baseline. |
| **`PROMPT_ENUMERATION`** | Identifies prompt repetition or minor variations (common in prompt-fuzzing and scraping). | Converts prompts into 3-word shingles, generates **MinHash** signatures (10 hashes using fast `cyrb53` algorithm), and calculates **Jaccard Similarity** (threshold $\ge 0.8$) over a sliding window. |
| **`FARM_BEHAVIOR`** | Detects cross-subject correlation (bot farms or distributed scraper attacks). | Compares prompt MinHash signatures globally across *all* subjects in a sliding window. Triggered if the same semantic prompt is sent by multiple distinct accounts. |
| **`TOKEN_DENSITY`** | Spots output token density anomalies (e.g., "extract all data" fishing attacks). | Tracks the ratio of Output Tokens to Input Tokens. Compares this ratio to a running EMA of the user's output-to-input density. |
| **`SPEND_SPIKE`** | Identifies runaway financial spending. | Tracks daily spend per user and compares it against their historical daily spend EMA. Flags shifts exceeding a configurable multiplier. |
| **`BUDGET_EXHAUSTION`** | Identifies scraping attempts that repeatedly push the account to the absolute limit. | Increments a counter whenever a user's remaining sliding window capacity drops below 10%. |

---

## 📈 Progressive Mitigation & Abuse Scoring

Sentinal accumulates a running **Abuse Score** based on the flags raised during requests. You can customize the penalty weight of each abuse flag and set Progressive Mitigation thresholds:

```typescript
abuseDetection: {
  scoreWeights: {
    velocitySpike: 20,
    promptRepetition: 15,
    spendSpike: 30,
    budgetExhaustion: 10,
    crossSubjectCorrelation: 50,
    tokenDensityAnomaly: 50
  },
  scoreThresholds: {
    softThrottle: 30,         // Add delay to requests once score >= 30
    hardBlock: 90,            // Reject requests once score >= 90
    throttleDelayMs: 1500,    // Delay duration
    exhaustionTriggerCount: 3 // Strikes before flagging exhaustion
  }
}
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** (v18 or higher recommended)
- **Redis Server** (running locally on `localhost:6379`)

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/edwinjojie/sentinal.git
cd sentinal
npm install
```

### 3. Usage Example

Initialize `SentinalGuard` with your LLM provider and target rules:

```typescript
import { SentinalGuard } from './src/core/guard';
import { OllamaAdapter } from './src/providers/ollamaAdapter';

// 1. Initialize Ollama adapter or a custom LLM provider
const provider = new OllamaAdapter();

// 2. Define your guard settings
const guard = new SentinalGuard(
  provider, 
  {
    minuteTokenLimit: 5000,
    dailyCostLimitUSD: 10.00,
    blockOnViolation: true,
    abuseDetection: {
      promptSimilarityWindowMs: 60000,
      promptSimilarityThreshold: 3,
      scoreWeights: {
        promptRepetition: 25,
        velocitySpike: 15
      },
      scoreThresholds: {
        softThrottle: 40,
        hardBlock: 80,
        throttleDelayMs: 1000
      }
    }
  },
  {
    onAllowed: (ctx) => console.log(`Allowed! Score: ${ctx.abuseScore}`),
    onBlocked: (ctx) => console.warn(`Blocked! Reason: ${ctx.reason}`)
  }
);

// 3. Wrap generate requests
async function askAI() {
  try {
    const response = await guard.generate({
      subjectId: 'user_456',
      model: 'llama3',
      prompt: 'Explain Distributed Lock Management in Redis.',
    });
    console.log(response.output);
  } catch (error) {
    console.error('Request was denied:', error.message);
  }
}
```

### 4. Running the Tests & Examples
Execute any of the test scenarios located in the `/examples` folder:
```bash
# Test Token Density Anomalies
npx ts-node examples/test-token-density.ts

# Test Abuse Detection (Similarity & Spend Shifts)
npx ts-node examples/test-abuse-detection.ts

# Test Distributed Bot Farm / Cross-Subject Correlation
npx ts-node examples/test-cross-subject.ts
```

---

## 🖥️ Visual Tester Dashboard

Sentinal includes a built-in telemetry UI to monitor limits, view active subjects, adjust rules, and visually observe throttling or blocks in real-time.

```bash
# Start both the Tester API Server and the Vite Web Frontend
npm run ui:dev
```
Open **`http://localhost:5173`** (or the port outputted in the command line) to access the interactive dashboard.

---

## 🔒 License
This project is licensed under the ISC License - see the [LICENSE](file:///c:/Users/jojie/OneDrive/Desktop/projects/sentinal/LICENSE) file for details.