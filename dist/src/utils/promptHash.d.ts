/**
 * Normalizes a prompt to reduce false negatives in similarity detection:
 * 1. Lowercases the string
 * 2. Removes punctuation
 * 3. Collapses multiple whitespace characters to single spaces
 * 4. Trims leading and trailing whitespace
 */
export declare function normalizePrompt(prompt: string): string;
/**
 * Normalizes and hashes a prompt.
 */
export declare function hashPrompt(prompt: string): string;
