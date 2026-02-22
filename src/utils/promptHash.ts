/**
 * Fast, non-cryptographic hash function (cyrb53)
 * Suitable for quickly hashing strings like prompts.
 * See: https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 */
function cyrb53(str: string, seed = 0): number {
    let h1 = 0xdeadbeef ^ seed
    let h2 = 0x41c6ce57 ^ seed
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i)
        h1 = Math.imul(h1 ^ ch, 2654435761)
        h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)

    return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * Normalizes a prompt to reduce false negatives in similarity detection:
 * 1. Lowercases the string
 * 2. Removes punctuation
 * 3. Collapses multiple whitespace characters to single spaces
 * 4. Trims leading and trailing whitespace
 */
export function normalizePrompt(prompt: string): string {
    if (!prompt) return ''

    return prompt
        .toLowerCase()
        .replace(/[^\w\s]|_/g, '') // remove punctuation
        .replace(/\s+/g, ' ') // collapse whitespaces
        .trim()
}

/**
 * Generates 3-word shingles from a normalized text
 */
function getShingles(text: string, size = 3): string[] {
    const words = text.split(' ').filter(w => w.length > 0)
    if (words.length < size) {
        return words.length > 0 ? [words.join(' ')] : []
    }
    const shingles: string[] = []
    for (let i = 0; i <= words.length - size; i++) {
        shingles.push(words.slice(i, i + size).join(' '))
    }
    return shingles
}

/**
 * Generates a MinHash signature for a set of shingles.
 * Uses multiple seed values for the cyrb53 hash function.
 */
function getMinHashSignature(shingles: string[], numHashes = 10): number[] {
    const signature = new Array(numHashes).fill(Infinity)

    if (shingles.length === 0) return signature

    for (let i = 0; i < numHashes; i++) {
        let minHash = Infinity
        for (const shingle of shingles) {
            const hash = cyrb53(shingle, i)
            if (hash < minHash) {
                minHash = hash
            }
        }
        signature[i] = minHash
    }

    return signature
}

/**
 * Calculates the Jaccard similarity between two MinHash signatures.
 */
export function calculateJaccardSimilarity(sig1: number[], sig2: number[]): number {
    if (sig1.length === 0 || sig2.length === 0 || sig1.length !== sig2.length) return 0

    let matches = 0
    for (let i = 0; i < sig1.length; i++) {
        // Infinity means empty signature
        if (sig1[i] !== Infinity && sig1[i] === sig2[i]) {
            matches++
        }
    }

    return matches / sig1.length
}

/**
 * Returns a small MinHash signature (represented as an array of numbers) for a prompt.
 * This is used for checking semantic similarity (Jaccard similarity > 0.8) without ML models.
 */
export function hashPrompt(prompt: string): number[] {
    const normalized = normalizePrompt(prompt)
    if (!normalized) return new Array(10).fill(Infinity)

    // Instead of hashing the full prompt, we break it into 3-word shingles
    const shingles = getShingles(normalized, 3)

    // Return a MinHash signature (e.g. 10 hashes)
    return getMinHashSignature(shingles, 10)
}
