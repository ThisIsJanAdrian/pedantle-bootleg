import crypto from "node:crypto";
import { fetchRandomArticle } from "./wikipedia.js";
import { tokenize, normalizeWord, stemWord, type Token } from "./tokenizer.js";
import {
  cosineSimilarity,
  buildNeighborPool,
  findTopKThreshold,
  type VectorMap,
  type NeighborPool,
} from "./wordVectors.js";

// A guess only counts as "close" to a hidden word if it's within that word's actual
// nearest-neighbor rank in the embedding, not just above some raw similarity score —
// this mirrors real Pedantle's red/orange/green model instead of a smooth 0-100 gradient.
const TOP_K_NEIGHBORS = 1000;

// Neighbor ranking only searches the 50k most frequent words (see buildNeighborPool) —
// scanning the full ~400k-word vocab took ~500ms *per word*, which made even one guess
// against a fresh article (dozens of still-hidden words) take tens of seconds.
const NEIGHBOR_POOL_SIZE = 50_000;

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}

interface TargetWord {
  normalized: string;
  stem: string;
  vector?: Float32Array;
}

export interface GuessRecord {
  word: string;
  temperature: number;
  guessNumber: number;
  matched: boolean;
}

export type WordTemplate =
  | { isWord: false; text: string }
  | { isWord: true; revealed: true; text: string }
  | {
      isWord: true;
      revealed: false;
      length: number;
      temperature: number;
      hintText?: string;
    };

export interface GameView {
  titleTemplate: WordTemplate[];
  bodyTemplate: WordTemplate[];
  guesses: GuessRecord[];
  gameWon: boolean;
  debug?: { title: string; body: string };
}

interface BestGuess {
  word: string;
  score: number;
}

interface GameState {
  title: string;
  titleTokens: Token[];
  bodyTokens: Token[];
  uniqueWords: Map<string, TargetWord>;
  revealedStems: Set<string>;
  guessedStems: Set<string>;
  // Per hidden target word, the closest guess made against it so far — surfaced to the
  // client as ghost text over that word's box (see buildTemplate), not the secret word.
  bestGuesses: Map<string, BestGuess>;
  guesses: GuessRecord[];
}

let globalVectors: VectorMap | null = null;
let globalPool: NeighborPool | null = null;
let devMode = false;
const games = new Map<string, GameState>();

// Neighbor-rank thresholds are expensive to compute (a pool scan per word, see
// findTopKThreshold) but only ever depend on the static embedding, so they're cached here
// for the lifetime of the server rather than per game — common words warm up quickly.
const neighborThresholdCache = new Map<string, number>();

export function initGameModule(vectors: VectorMap, options: { devMode?: boolean } = {}): void {
  globalVectors = vectors;
  globalPool = buildNeighborPool(vectors, NEIGHBOR_POOL_SIZE);
  devMode = options.devMode ?? false;
}

function requireVectors(): VectorMap {
  if (!globalVectors) throw new Error("Game module not initialized with word vectors");
  return globalVectors;
}

function requirePool(): NeighborPool {
  if (!globalPool) throw new Error("Game module not initialized with word vectors");
  return globalPool;
}

function getNeighborThreshold(word: string, vector: Float32Array): number | null {
  const cached = neighborThresholdCache.get(word);
  if (cached !== undefined) return cached;
  const threshold = findTopKThreshold(requirePool(), vector, word, TOP_K_NEIGHBORS);
  if (threshold !== null) neighborThresholdCache.set(word, threshold);
  return threshold;
}

function buildUniqueWords(tokens: Token[], into: Map<string, TargetWord>): void {
  const vectors = requireVectors();
  for (const token of tokens) {
    if (!token.isWord) continue;
    // normalizeWord() strips accents (café -> cafe) so an ASCII guess matches; words in
    // other scripts have no ASCII form and normalize to "", which is skipped here — they
    // stay in the text but can never be revealed.
    const normalized = normalizeWord(token.text);
    if (!normalized || into.has(normalized)) continue;
    into.set(normalized, {
      normalized,
      stem: stemWord(token.text),
      vector: vectors.get(normalized),
    });
  }
}

export async function createGame(): Promise<{ gameId: string; view: GameView }> {
  const article = await fetchRandomArticle();
  const titleTokens = tokenize(article.title);
  const bodyTokens = tokenize(article.introText);

  const uniqueWords = new Map<string, TargetWord>();
  buildUniqueWords(titleTokens, uniqueWords);
  buildUniqueWords(bodyTokens, uniqueWords);

  const state: GameState = {
    title: article.title,
    titleTokens,
    bodyTokens,
    uniqueWords,
    revealedStems: new Set(),
    guessedStems: new Set(),
    bestGuesses: new Map(),
    guesses: [],
  };

  const gameId = crypto.randomUUID();
  games.set(gameId, state);

  return { gameId, view: buildView(state) };
}

// revealHints controls whether a hidden word's box shows a ghost overlay of the closest
// guess made against it so far, once that guess has landed within its neighbor rank. The
// title deliberately never does this, to keep it a blind guess like the rest of Pedantle.
function buildTemplate(tokens: Token[], state: GameState, revealHints: boolean): WordTemplate[] {
  return tokens.map((token) => {
    if (!token.isWord) {
      return { isWord: false, text: token.text };
    }
    const normalized = normalizeWord(token.text);
    const target = state.uniqueWords.get(normalized);
    const revealed = !!target && state.revealedStems.has(target.stem);
    if (revealed) {
      return { isWord: true, revealed: true, text: token.text };
    }
    const best = state.bestGuesses.get(normalized);
    return {
      isWord: true,
      revealed: false,
      length: token.text.length,
      temperature: best?.score ?? 0,
      ...(revealHints && best ? { hintText: best.word } : {}),
    };
  });
}

function isGameWon(state: GameState): boolean {
  return state.titleTokens
    .filter((t) => t.isWord)
    .every((t) => {
      const normalized = normalizeWord(t.text);
      const target = state.uniqueWords.get(normalized);
      return !!target && state.revealedStems.has(target.stem);
    });
}

function buildView(state: GameState): GameView {
  const view: GameView = {
    titleTemplate: buildTemplate(state.titleTokens, state, false),
    bodyTemplate: buildTemplate(state.bodyTokens, state, true),
    guesses: [...state.guesses].sort((a, b) => b.temperature - a.temperature),
    gameWon: isGameWon(state),
  };
  if (devMode) {
    view.debug = {
      title: state.title,
      body: state.bodyTokens.map((t) => t.text).join(""),
    };
  }
  return view;
}

function getGame(gameId: string): GameState {
  const state = games.get(gameId);
  if (!state) throw new NotFoundError("Game not found");
  return state;
}

export function submitGuess(
  gameId: string,
  rawGuess: string
): { view: GameView; alreadyGuessed: boolean } {
  const state = getGame(gameId);
  const normGuess = normalizeWord(rawGuess);
  if (!normGuess) throw new BadRequestError("Guess must contain letters or numbers");

  const stemGuess = stemWord(rawGuess);

  if (state.guessedStems.has(stemGuess)) {
    return { view: buildView(state), alreadyGuessed: true };
  }
  state.guessedStems.add(stemGuess);

  let matched = false;
  for (const target of state.uniqueWords.values()) {
    if (target.stem === stemGuess) {
      state.revealedStems.add(target.stem);
      matched = true;
    }
  }

  let temperature = 0;
  if (matched) {
    temperature = 100;
  } else {
    const vectors = requireVectors();
    const guessVector = vectors.get(normGuess);
    if (guessVector) {
      for (const target of state.uniqueWords.values()) {
        if (state.revealedStems.has(target.stem) || !target.vector) continue;
        const threshold = getNeighborThreshold(target.normalized, target.vector);
        if (threshold === null) continue;
        const similarity = cosineSimilarity(guessVector, target.vector);
        if (similarity < threshold) continue; // outside this word's top-K neighbors: no hint
        const scaled = Math.max(1, Math.min(99, Math.round(similarity * 100)));
        const prevBest = state.bestGuesses.get(target.normalized)?.score ?? 0;
        if (scaled > prevBest) {
          state.bestGuesses.set(target.normalized, { word: rawGuess, score: scaled });
        }
        if (scaled > temperature) temperature = scaled;
      }
    }
  }

  state.guesses.push({
    word: rawGuess,
    temperature,
    guessNumber: state.guesses.length + 1,
    matched,
  });

  return { view: buildView(state), alreadyGuessed: false };
}
