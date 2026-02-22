"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LimitExceededError = void 0;
class LimitExceededError extends Error {
    constructor(reason) {
        super(reason);
        this.name = 'LimitExceededError';
        this.reason = reason;
    }
}
exports.LimitExceededError = LimitExceededError;
