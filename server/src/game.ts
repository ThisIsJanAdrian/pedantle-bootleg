import crypto from "node:crypto";
import { fetchRandomArticle } from "./wikipedia.js";
import { tokenize, normalizeWord, stemWord, type Token } from "./tokenizer.js";
import {
  cosineSimilarity,
  buildNeighborPool,
  computeNeighborSimilarities,
  rankWithinNeighbors,
  type VectorMap,
  type NeighborPool,
} from "./wordVectors.js";

// A guess only counts as "close" to a hidden word if it's within that word's actual
// nearest-neighbor rank in the embedding, not just above some raw similarity score —
// this mirrors real Pedantle's red/orange/green model instead of a smooth 0-100 gradient.
// Kept tight (100, not the ~1000 real Pedantle-style games often use) because looser cutoffs
// let one-off embedding curiosities through — e.g. "xylophone" lands at rank 317 against
// "cactus" (cosine 0.35) despite no real relation. 100 still admits genuine content-word
// neighbors while cutting off most of that noise. It does NOT fix words whose embeddings are
// inherently non-specific (very common/short words like "of", "a", "is" — see
// STOPWORD_FREQUENCY_CUTOFF below): "history" ranks 87th-nearest to "of" outright, so no
// cutoff short of gutting real hints elsewhere would exclude it by rank alone.
const TOP_K_NEIGHBORS = 100;

// Score is driven by RANK within the neighbor list, not raw cosine similarity — raw
// similarity magnitudes aren't comparable across words (a diffuse word's threshold might
// sit at 0.35, a specific word's at 0.15), so the same similarity value means wildly
// different things depending on the target. Rank is directly comparable: rank 5 is always
// "very close," regardless of word. p > 1 makes the curve concave — only genuinely
// top-ranked guesses glow meaningfully warm, the tail of the neighbor list stays dim — which
// reads as a more discriminating hint than a flat linear-in-rank falloff.
const SCORE_CURVE_EXPONENT = 3;

// Neighbor ranking only searches the 50k most frequent words (see buildNeighborPool) —
// scanning the full ~400k-word vocab took ~500ms *per word*, which made even one guess
// against a fresh article (dozens of still-hidden words) take tens of seconds.
const NEIGHBOR_POOL_SIZE = 50_000;

// The most frequent words in the embedding (articles, prepositions, conjunctions, auxiliary
// verbs, punctuation tokens) have such non-specific vectors that huge swaths of ordinary
// vocabulary score misleadingly high similarity against them — "history" is the 87th-nearest
// neighbor of "of" outright, not a marginal match a rank cutoff could exclude. These words
// are excluded from the closeness system entirely: still guessable by exact/stemmed match
// (see submitGuess), never hinted or ghosted. GloVe's vocab file is frequency-sorted, so
// "most frequent" is just "first N" — see buildStopwordSet.
const STOPWORD_FREQUENCY_CUTOFF = 300;

// Games with no activity (no guess, and originally just "created and never touched" — e.g.
// the duplicate game React's StrictMode double-mount creates client-side and immediately
// abandons in favor of the second, or a player who just closes the tab) are swept out of
// memory after this long, so `games` doesn't grow unbounded over a long-running server.
const GAME_TTL_MS = 2 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

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
      peekText?: string;
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
  lastActivity: number;
}

let globalVectors: VectorMap | null = null;
let globalPool: NeighborPool | null = null;
let globalStopwords: Set<string> | null = null;
let devMode = false;
const games = new Map<string, GameState>();

// vectors' Map iteration order is frequency order (see buildNeighborPool for why), so the
// first `limit` entries are exactly the most frequent words in the embedding.
function buildStopwordSet(vectors: VectorMap, limit: number): Set<string> {
  const stopwords = new Set<string>();
  for (const word of vectors.keys()) {
    if (stopwords.size >= limit) break;
    stopwords.add(word);
  }
  return stopwords;
}

// Each entry is a word's top-1000 neighbor similarities, sorted descending — expensive to
// compute (a pool scan per word, see computeNeighborSimilarities) but only ever depends on
// the static embedding, so it's cached here for the lifetime of the server rather than per
// game. Guess-time lookups are then just a binary search (rankWithinNeighbors).
const neighborSimilarityCache = new Map<string, Float32Array>();

function sweepStaleGames(): void {
  const cutoff = Date.now() - GAME_TTL_MS;
  for (const [id, state] of games) {
    if (state.lastActivity < cutoff) games.delete(id);
  }
}

export function initGameModule(vectors: VectorMap, options: { devMode?: boolean } = {}): void {
  globalVectors = vectors;
  globalPool = buildNeighborPool(vectors, NEIGHBOR_POOL_SIZE);
  globalStopwords = buildStopwordSet(vectors, STOPWORD_FREQUENCY_CUTOFF);
  devMode = options.devMode ?? false;
  // unref() so this background sweep never keeps the process alive on its own.
  setInterval(sweepStaleGames, CLEANUP_INTERVAL_MS).unref();
}

function requireVectors(): VectorMap {
  if (!globalVectors) throw new Error("Game module not initialized with word vectors");
  return globalVectors;
}

function requirePool(): NeighborPool {
  if (!globalPool) throw new Error("Game module not initialized with word vectors");
  return globalPool;
}

function requireStopwords(): Set<string> {
  if (!globalStopwords) throw new Error("Game module not initialized with word vectors");
  return globalStopwords;
}

function getNeighborSimilarities(word: string, vector: Float32Array): Float32Array | null {
  const cached = neighborSimilarityCache.get(word);
  if (cached !== undefined) return cached;
  const sims = computeNeighborSimilarities(requirePool(), vector, word, TOP_K_NEIGHBORS);
  if (sims !== null) neighborSimilarityCache.set(word, sims);
  return sims;
}

// Converts a guess's rank among a word's nearest neighbors (1 = closest) into a 1-99
// score. See SCORE_CURVE_EXPONENT for why this is rank-based rather than similarity-based.
function scoreFromRank(rank: number, poolSize: number): number {
  const percentile = 1 - (rank - 1) / poolSize;
  return Math.max(1, Math.min(99, Math.round(100 * Math.pow(percentile, SCORE_CURVE_EXPONENT))));
}

// Precomputes and caches every target word's neighbor-similarity list up front, during
// game creation, instead of lazily on whatever guess first needs each word. Same total
// work either way, but this way the player eats the wait during "Loading a fresh
// article..." rather than a guess suddenly hanging mid-game.
function warmNeighborCache(uniqueWords: Map<string, TargetWord>): void {
  for (const target of uniqueWords.values()) {
    if (target.vector) getNeighborSimilarities(target.normalized, target.vector);
  }
}

function buildUniqueWords(tokens: Token[], into: Map<string, TargetWord>): void {
  const vectors = requireVectors();
  const stopwords = requireStopwords();
  for (const token of tokens) {
    if (!token.isWord) continue;
    // normalizeWord() strips accents (café -> cafe) so an ASCII guess matches; words in
    // other scripts have no ASCII form and normalize to "", which is skipped here — they
    // stay in the text but can never be revealed.
    const normalized = normalizeWord(token.text);
    if (!normalized || into.has(normalized)) continue;
    // Stopwords get no vector at all, which submitGuess already treats as "no closeness
    // signal" (see the `!target.vector` guard there) — same code path as a word absent
    // from the embedding, just for a different reason. Still exact/stem-guessable.
    into.set(normalized, {
      normalized,
      stem: stemWord(token.text),
      vector: stopwords.has(normalized) ? undefined : vectors.get(normalized),
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
  warmNeighborCache(uniqueWords);

  const state: GameState = {
    title: article.title,
    titleTokens,
    bodyTokens,
    uniqueWords,
    revealedStems: new Set(),
    guessedStems: new Set(),
    bestGuesses: new Map(),
    guesses: [],
    lastActivity: Date.now(),
  };

  const gameId = crypto.randomUUID();
  games.set(gameId, state);

  return { gameId, view: buildView(state) };
}

// revealHints controls whether a hidden word's box shows a ghost overlay of the closest
// guess made against it so far, once that guess has landed within its neighbor rank. The
// title deliberately never does this, to keep it a blind guess like the rest of Pedantle.
// allowPeek controls whether the client is sent the real text for a still-hidden word so it
// can be clicked to view briefly — only meaningful once the game is already won, since the
// title (the actual challenge) is by definition fully revealed by that point already; any
// body words still hidden at that point are just leftover trivia, not a spoiler risk.
function buildTemplate(
  tokens: Token[],
  state: GameState,
  revealHints: boolean,
  allowPeek: boolean
): WordTemplate[] {
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
      ...(allowPeek ? { peekText: token.text } : {}),
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
  const won = isGameWon(state);
  const view: GameView = {
    titleTemplate: buildTemplate(state.titleTokens, state, false, false),
    bodyTemplate: buildTemplate(state.bodyTokens, state, true, won),
    guesses: [...state.guesses].sort((a, b) => b.temperature - a.temperature),
    gameWon: won,
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
  state.lastActivity = Date.now();
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

  // An exact match on one word (e.g. "calculate") shouldn't stop this same guess from also
  // hinting at other still-hidden words it's genuinely close to (e.g. "calculator") — so
  // this always runs, even when `matched` is already true. revealedStems already excludes
  // whatever this guess just solved, so there's no risk of re-scoring it.
  let temperature = matched ? 100 : 0;
  const vectors = requireVectors();
  const guessVector = vectors.get(normGuess);
  if (guessVector) {
    for (const target of state.uniqueWords.values()) {
      if (state.revealedStems.has(target.stem) || !target.vector) continue;
      const sims = getNeighborSimilarities(target.normalized, target.vector);
      if (sims === null) continue;
      const similarity = cosineSimilarity(guessVector, target.vector);
      const rank = rankWithinNeighbors(sims, similarity);
      if (rank > sims.length) continue; // outside this word's top-K neighbors: no hint
      const scaled = scoreFromRank(rank, sims.length);
      const prevBest = state.bestGuesses.get(target.normalized)?.score ?? 0;
      if (scaled > prevBest) {
        state.bestGuesses.set(target.normalized, { word: rawGuess, score: scaled });
      }
      if (scaled > temperature) temperature = scaled;
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
