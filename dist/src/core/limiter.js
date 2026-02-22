"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkLimits = checkLimits;
const usageStore_1 = require("../storage/usageStore");
async function checkLimits(subjectId, model, config) {
    const { minuteRemaining, dailyRemaining } = await (0, usageStore_1.getRemainingBudget)(subjectId, model);
    // If budget exists and is exhausted (<= 0), limit is exceeded.
    // Note: reserveBudget allows if current >= requested.
    // If we just want to check "is blocked?", then if remaining <= 0 we are blocked for any request > 0.
    if (minuteRemaining !== null && minuteRemaining <= 0) {
        return { allowed: false, reason: 'Minute token limit exceeded' };
    }
    if (dailyRemaining !== null && dailyRemaining <= 0) {
        return { allowed: false, reason: 'Daily cost limit exceeded' };
    }
    return { allowed: true };
}
