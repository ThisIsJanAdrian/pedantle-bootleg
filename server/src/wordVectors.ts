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
