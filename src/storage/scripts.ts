export const INCREMENT_WITH_TTL = `
local current = redis.call("INCRBY", KEYS[1], ARGV[1])
if tonumber(current) == tonumber(ARGV[1]) then
  redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return current
`

export const RESERVE_BUDGET = `
local key = KEYS[1]
local requested = tonumber(ARGV[1])
local ttl = ARGV[2]
local limit = tonumber(ARGV[3])

-- Get current budget or initialize to limit if not exists
local current = redis.call("GET", key)
if not current then
  current = limit
  redis.call("SET", key, current, "EX", ttl)
else
  current = tonumber(current)
end

if current < requested then
  return -1
end

local new = redis.call("DECRBY", key, requested)
return new
`

export const RESERVE_SLIDING_WINDOW = `
local key = KEYS[1]
local requested = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local limit = tonumber(ARGV[4])
local member = ARGV[5] -- "tokens:nonce"

-- 1. Remove old
local clearBefore = now - window
redis.call("ZREMRANGEBYSCORE", key, "-inf", clearBefore)

-- 2. Sum usage
local current_usage = 0
local range = redis.call("ZRANGE", key, 0, -1)
for _, item in ipairs(range) do
    -- item is "tokens:nonce"
    local t = tonumber(string.match(item, "^(%-?%d+):"))
    if t then
        current_usage = current_usage + t
    end
end

-- 3. Check
if current_usage + requested > limit then
    return -1
end

-- 4. Add
redis.call("ZADD", key, now, member)
redis.call("EXPIRE", key, window)

return limit - (current_usage + requested)
`

export const RESERVE_UNIFIED = `
local minuteKey = KEYS[1]
local dailyKey = KEYS[2]

local now = tonumber(ARGV[1])
local minuteWindow = tonumber(ARGV[2])
local minuteLimit = tonumber(ARGV[3])
local dailyTTL = tonumber(ARGV[4])
local dailyLimit = tonumber(ARGV[5])
local tokens = tonumber(ARGV[6])
local cost = tonumber(ARGV[7])
local member = ARGV[8] -- "tokens:nonce" for sliding window

-- 1. Check Daily Limit (Fixed Window / Budget Bucket)
local dailyBudget = redis.call("GET", dailyKey)
if not dailyBudget then
    dailyBudget = dailyLimit
    redis.call("SET", dailyKey, dailyBudget, "EX", dailyTTL)
else
    dailyBudget = tonumber(dailyBudget)
end

if dailyBudget < cost then
    return {-1, "Daily cost limit exceeded"}
end

-- 2. Check Minute Limit (Sliding Window)
-- Remove old entries
local clearBefore = now - minuteWindow
redis.call("ZREMRANGEBYSCORE", minuteKey, "-inf", clearBefore)

-- Sum current usage
local currentMinuteUsage = 0
local range = redis.call("ZRANGE", minuteKey, 0, -1)
for _, item in ipairs(range) do
    local t = tonumber(string.match(item, "^(%-?%d+):"))
    if t then
        currentMinuteUsage = currentMinuteUsage + t
    end
end

if currentMinuteUsage + tokens > minuteLimit then
    return {-1, "Minute token limit exceeded"}
end

-- 3. Commit Reservation
-- Decrement Daily Budget
local newDaily = redis.call("DECRBY", dailyKey, cost)

-- Add to Minute Sliding Window
redis.call("ZADD", minuteKey, now, member)
redis.call("EXPIRE", minuteKey, minuteWindow)

-- Return remaining budgets? 
-- Minute remaining is dynamic (limit - usage - requested)
-- Daily is newDaily.
local minuteRemaining = minuteLimit - (currentMinuteUsage + tokens)

return {1, minuteRemaining, newDaily, currentMinuteUsage + tokens}
`

export const CHECK_PROMPT_SIMILARITY = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

-- 1. Remove old entries
local clearBefore = now - window
redis.call("ZREMRANGEBYSCORE", key, "-inf", clearBefore)

-- 2. Return all remaining signatures
-- Each member is stored as "signatureJSON:nonce"
local range = redis.call("ZRANGE", key, 0, -1)
local signatures = {}

for _, item in ipairs(range) do
    -- Extract the signatureJSON part
    local sig = string.match(item, "^(.*):.*$")
    if sig then
        table.insert(signatures, sig)
    end
end

return signatures
`

export const ADD_PROMPT_SIGNATURE = `
local key = KEYS[1]
local signatureJSON = ARGV[1]
local now = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local nonce = ARGV[4]

local member = signatureJSON .. ":" .. nonce
redis.call("ZADD", key, now, member)
redis.call("EXPIRE", key, window)
return 1
`

export const CHECK_DAILY_SPEND_SPIKE = `
local todayKey = KEYS[1]
local emaKey = KEYS[2]

local multiplier = tonumber(ARGV[1])
local estimatedCostCents = tonumber(ARGV[2])

local todayCost = tonumber(redis.call("GET", todayKey) or "0")
local emaCost = tonumber(redis.call("GET", emaKey) or "0")

if emaCost > 0 and (todayCost + estimatedCostCents) > multiplier * emaCost then
    return 1
end
return 0
`

export const RECORD_DAILY_SPEND = `
local todayKey = KEYS[1]
local emaKey = KEYS[2]
local lastActiveDateKey = KEYS[3]

local costCents = tonumber(ARGV[1])
local todayString = ARGV[2]
local alpha = 0.14

local lastActiveDate = redis.call("GET", lastActiveDateKey)
local todayCost = tonumber(redis.call("GET", todayKey) or "0")
local emaCost = tonumber(redis.call("GET", emaKey) or "0")

if lastActiveDate and lastActiveDate ~= todayString then
    if emaCost == 0 then
        emaCost = todayCost
    else
        emaCost = math.floor((alpha * todayCost) + ((1 - alpha) * emaCost))
    end
    redis.call("SET", emaKey, emaCost)
    todayCost = 0
end

redis.call("SET", lastActiveDateKey, todayString)

todayCost = todayCost + costCents
redis.call("SET", todayKey, todayCost, "EX", 172800)

return 1
`

export const INCREMENT_ABUSE_SCORE = `
local key = KEYS[1]
local delta = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = tonumber(redis.call("GET", key) or "0")
local newScore = current + delta

redis.call("SET", key, newScore, "EX", ttl)
return newScore
`

export const INCREMENT_EXHAUSTION_COUNT = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])

local current = tonumber(redis.call("GET", key) or "0")
local newCount = current + 1

if current == 0 then
    redis.call("SET", key, newCount, "EX", ttl)
else
    redis.call("INCR", key)
end

return newCount
`

export const RECORD_TOKEN_DENSITY = `
local emaKey = KEYS[1]
local ratio = tonumber(ARGV[1])
local multiplier = tonumber(ARGV[2])
local alpha = 0.2

local currentEmaStr = redis.call("GET", emaKey)
local currentEma = currentEmaStr and tonumber(currentEmaStr) or 0
local isAnomaly = 0

if currentEma > 0 then
    if ratio > (currentEma * multiplier) then
        isAnomaly = 1
    end
    
    local newEma = (alpha * ratio) + ((1 - alpha) * currentEma)
    redis.call("SET", emaKey, string.format("%.4f", newEma))
else
    redis.call("SET", emaKey, string.format("%.4f", ratio))
end

return isAnomaly
`
