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
local member_id = ARGV[5]

-- 1. Remove old entries outside the window
local clearBefore = now - window
redis.call("ZREMRANGEBYSCORE", key, "-inf", clearBefore)

-- 2. Sum current usage in window
local current_usage = 0
local range = redis.call("ZRANGE", key, 0, -1)
for _, score in ipairs(range) do
    current_usage = current_usage + tonumber(score)
end

-- 3. Check limit
if current_usage + requested > limit then
    return -1
end

-- 4. Add new request
-- We store the tokens as the score? No, ZSET scores are for sorting (timestamp).
-- We store tokens in the member? No, members must be unique.
-- Wait. ZSET: Member = ID, Score = Timestamp.
-- But how do we store the *amount* of tokens? 
-- If we just count requests, ZCARD is fine. 
-- But we need token bucket. 
-- WE NEED TO STORE TOKENS IN THE MEMBER OR USE A SECOND HASH.
-- Or, we use the Score for Timestamp, and the Member string contains the token count? 
-- "tokens:unique_id"
-- Then we have to parse the member string in Lua.
-- Let's try that. Member format: "tokens:timestamp:random"

-- Lua Split function
-- (Simpler: just use a separator like ":")

-- Actually, user suggested: "ZADD timestamp tokens". 
-- Wait. ZADD key score member. 
-- User said: "ZADD timestamp tokens". This implies Member=Tokens, Score=Timestamp.
-- BUT uniqueness! If multiple requests have same token count, they overwrite! 
-- So Member must be unique. 
-- ZADD key timestamp "tokens:nonce" 

-- Let's refine the script.

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

