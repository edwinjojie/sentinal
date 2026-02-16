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

