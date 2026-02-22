"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashKey = hashKey;
function hashKey(input) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}
exports.default = hashKey;
