"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePrompt = normalizePrompt;
exports.hashPrompt = hashPrompt;
/**
 * Fast, non-cryptographic hash function (cyrb53)
 * Suitable for quickly hashing strings like prompts.
 * See: https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 */
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/**
 * Normalizes a prompt to reduce false negatives in similarity detection:
 * 1. Lowercases the string
 * 2. Removes punctuation
 * 3. Collapses multiple whitespace characters to single spaces
 * 4. Trims leading and trailing whitespace
 */
function normalizePrompt(prompt) {
    if (!prompt)
        return '';
    return prompt
        .toLowerCase()
        .replace(/[^\w\s]|_/g, '') // remove punctuation
        .replace(/\s+/g, ' ') // collapse whitespaces
        .trim();
}
/**
 * Normalizes and hashes a prompt.
 */
function hashPrompt(prompt) {
    const normalized = normalizePrompt(prompt);
    return cyrb53(normalized).toString(16);
}
