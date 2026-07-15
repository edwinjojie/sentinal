# Sentinal 🛡️

**A high-performance, distributed, Redis-backed rate limiting, cost tracking, and abuse mitigation guardrail system designed specifically for production AI and LLM (Large Language Model) applications.**

Sentinal acts as an intelligent proxy/guard between your users and upstream LLM providers (e.g., OpenAI, Anthropic, Ollama), protecting production APIs from runaway token costs, prompt-injection attacks, bot-farm scraping behavior, and malicious resource exhaustion.

---

## 💡 The Core Concept: Pessimistic Reservation & Optimistic Commit

Standard API rate limiters operate on simple request counts. However, LLMs are billed and constrained by tokens and cost, which are highly variable and unknown until after the model finishes generating a response.

To prevent race conditions, budget overruns, and database-level lockups in distributed systems, Sentinal uses a **Pessimistic Reservation and Optimistic Commit** workflow:

User Request       +-------------------+       LLM API Calls       +--------------------+
------------->[1]  |                   |  =>[4]  |                    |
|   SentinalGuard   |                           |  Upstream Provider |
<-------------[6]  |                   |  <=[5]  |    (Ollama/OAI)    |
LLM Response     +---------+---------+     Actual Token Usage    +--------------------+
|
[2] Read | [3] Reserve
| [5a] Commit Delta
v
+-------------------+
|    Redis Store    |
| (Lua Scripting)   |
+-------------------+


### The Request Lifecycle
1. **Estimate:** Sentinal analyzes the incoming prompt to dynamically estimate token usage and calculate the maximum potential cost (e.g., using `AdaptiveEstimator`)[cite: 1].
2. **Pessimistic Reservation:** An atomic Lua script (`RESERVE_UNIFIED`) runs in Redis to verify if the estimated cost/tokens fit within the user's minute sliding window and daily cost limits[cite: 1]. If allowed, it pessimistically reserves the estimated capacity[cite: 1].
3. **Abuse Scoring & Mitigation:** Sentinal evaluates multiple threat vectors (repetition, velocity, spend spikes)[cite: 1]. If threats are detected, it triggers either a **Soft Throttle** (artificially delays the request via `throttleDelayMs`) or a **Hard Block** (blocks the request immediately, preserving upstream LLM resources)[cite: 1].
4. **Execution:** The request is safely dispatched to the upstream LLM[cite: 1].
5. **Optimistic Commit:** Once the LLM responds, Sentinal measures the actual token count and cost, commits the exact usage, and rollbacks/releases any over-reserved tokens/budget[cite: 1].

---

## 🧠 Advanced Abuse Detection Engine

Sentinal continuously monitors user behavioral patterns to detect and score potential abuse in real-time[cite: 1].

| Abuse Flag | Description | Technical Implementation |
| :--- | :--- | :--- |
| **Velocity Spike** | Sudden, anomalous surges in token consumption[cite: 1]. | Compares current minute usage against an Exponential Moving Average (EMA) baseline[cite: 1]. Flags if current usage exceeds a $3\times$ baseline. |
| **Prompt Enumeration** | Identifies semantic repetition or prompt-fuzzing/scraping[cite: 1]. | Converts prompts into 3-word shingles, generates MinHash signatures ($10$ hashes using fast `cyrb53` algorithm), and calculates Jaccard Similarity (threshold $\geq 0.8$) over a sliding window[cite: 1]. |
| **Farm Behavior** | Detects cross-subject correlation (bot farms or distributed scraper attacks)[cite: 1]. | Compares prompt MinHash signatures globally across all active subjects in a sliding window[cite: 1]. Triggered if identical semantic prompts originate from distinct accounts[cite: 1]. |
| **Token Density** | Spots output token density anomalies (e.g., "extract all data" fishing attacks)[cite: 1]. | Tracks the ratio of Output Tokens to Input Tokens, comparing it against a running EMA of the user's output-to-input density[cite: 1]. |
| **Spend Spike** | Identifies runaway financial spending[cite: 1]. | Tracks daily spend per user and compares it against historical daily spend EMA[cite: 1]. Flags shifts exceeding a configurable multiplier[cite: 1]. |
| **Budget Exhaustion** | Identifies scraping attempts designed to drain API quotas[cite: 1]. | Increments a counter whenever a user's remaining sliding window capacity drops below 10%[cite: 1]. |

---

## 🛠️ Tech Stack

*   **Runtime:** TypeScript & Node.js[cite: 1]
*   **Distributed Database:** Redis (uses sorted sets `ZSET` for sliding-window rate limiting, fast key-value pairs for metrics/EMAs, and custom atomic Lua scripts)[cite: 1].
*   **LLM Integrations:** Modular, pluggable LLM adapters (includes an `OllamaAdapter` out of the box)[cite: 1].
*   **Telemetry UI:** Express.js server + Vite frontend[cite: 1].

---

## 🚀 Getting Started

### 1. Prerequisites
*   Node.js (v18+)[cite: 1]
*   Redis Server (running locally on `localhost:6379`)[cite: 1]

### 2. Installation
```bash
git clone [https://github.com/edwinjojie/sentinal.git](https://github.com/edwinjojie/sentinal.git)
cd sentinal
npm install
3. Usage Example
TypeScript
import { SentinalGuard } from './src/core/guard';
import { OllamaAdapter } from './src/providers/ollamaAdapter';

const provider = new OllamaAdapter();

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
🖥️ Visual Tester Dashboard
Sentinal includes a built-in telemetry UI to monitor limits, view active subjects, adjust rules, and visually observe throttling or blocks in real-time[cite: 1].

Bash
# Start both the Tester API Server and the Vite Web Frontend
npm run ui:dev
Open http://localhost:5173 to access the interactive dashboard[cite: 1].
