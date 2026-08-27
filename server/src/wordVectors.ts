import fs from "node:fs";
import readline from "node:readline";

export type VectorMap = Map<string, Float32Array>;

export async function loadVectors(filePath: string): Promise<VectorMap> {
  const vectors: VectorMap = new Map();
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    const firstSpace = line.indexOf(" ");
    if (firstSpace === -1) continue;

    const word = line.slice(0, firstSpace);
    const rest = line.slice(firstSpace + 1);
    const parts = rest.split(" ");
    const vector = new Float32Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      vector[i] = Number(parts[i]);
    }
    vectors.set(word, vector);
  }

  return vectors;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// A flat, cache-friendly slice of the vocabulary used only for nearest-neighbor ranking
// (see findTopKThreshold). GloVe's vocab files are ordered by descending word frequency,
// so `vectors`'s Map iteration order already IS frequency order — taking the first `limit`
// entries keeps the neighbor universe to words a player might plausibly type, which is both
// ~40x cheaper to scan than the full ~400k vocab and arguably more correct: an obscure
// word's "nearest neighbor" being an even more obscure word isn't a useful hint anyway.
export interface NeighborPool {
  words: string[];
  flat: Float32Array;
  norms: Float32Array;
  dim: number;
}

export function buildNeighborPool(vectors: VectorMap, limit: number): NeighborPool {
  const words: string[] = [];
  const vecs: Float32Array[] = [];
  let dim = 0;
  for (const [word, vec] of vectors) {
    if (words.length >= limit) break;
    dim = vec.length;
    words.push(word);
    vecs.push(vec);
  }

  const flat = new Float32Array(words.length * dim);
  const norms = new Float32Array(words.length);
  for (let i = 0; i < words.length; i++) {
    flat.set(vecs[i], i * dim);
    let sumSq = 0;
    for (let d = 0; d < dim; d++) sumSq += vecs[i][d] * vecs[i][d];
    norms[i] = Math.sqrt(sumSq);
  }

  return { words, flat, norms, dim };
}

/**
 * The top k nearest-neighbor similarities of `targetVector` within `pool`, sorted
 * descending (index 0 = closest neighbor). Scans the pool once, keeping only the top k via
 * a bounded min-heap instead of a full sort of the whole pool. Callers should cache the
 * result per word (see rankWithinNeighbors), since it only ever depends on the static
 * embedding.
 */
export function computeNeighborSimilarities(
  pool: NeighborPool,
  targetVector: Float32Array,
  excludeWord: string,
  k: number
): Float32Array | null {
  const { words, flat, norms, dim } = pool;
  const n = words.length;

  let targetNorm = 0;
  for (let d = 0; d < dim; d++) targetNorm += targetVector[d] * targetVector[d];
  targetNorm = Math.sqrt(targetNorm);
  if (targetNorm === 0) return null;

  const heap = new Float64Array(k);
  let heapSize = 0;
  const heapPush = (v: number) => {
    heap[heapSize] = v;
    let i = heapSize++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent] <= heap[i]) break;
      const t = heap[parent];
      heap[parent] = heap[i];
      heap[i] = t;
      i = parent;
    }
  };
  const heapReplaceRoot = (v: number) => {
    heap[0] = v;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < heapSize && heap[l] < heap[smallest]) smallest = l;
      if (r < heapSize && heap[r] < heap[smallest]) smallest = r;
      if (smallest === i) break;
      const t = heap[i];
      heap[i] = heap[smallest];
      heap[smallest] = t;
      i = smallest;
    }
  };

  for (let j = 0; j < n; j++) {
    if (words[j] === excludeWord) continue;
    const off = j * dim;
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += targetVector[d] * flat[off + d];
    const sim = dot / (targetNorm * norms[j]);
    if (heapSize < k) {
      heapPush(sim);
    } else if (sim > heap[0]) {
      heapReplaceRoot(sim);
    }
  }

  const sorted = new Float32Array(heap.subarray(0, heapSize));
  sorted.sort().reverse();
  return sorted;
}

/**
 * Where `similarity` would land within a word's cached, descending neighbor-similarity
 * list — 1 is the nearest neighbor. Returns a rank greater than the list length if
 * `similarity` doesn't clear even the weakest kept neighbor (i.e. outside the top k).
 */
export function rankWithinNeighbors(sortedDesc: Float32Array, similarity: number): number {
  let lo = 0;
  let hi = sortedDesc.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedDesc[mid] > similarity) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}
