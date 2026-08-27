import crypto from "node:crypto";
import { fetchRandomArticle } from "./wikipedia.js";
import { tokenize, normalizeWord, stemWord, type Token } from "./tokenizer.js";
import { cosineSimilarity, type VectorMap } from "./wordVectors.js";

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
  | { isWord: true; revealed: false; length: number; temperature: number };

export interface GameView {
  titleTemplate: WordTemplate[];
  bodyTemplate: WordTemplate[];
  guesses: GuessRecord[];
  gameWon: boolean;
  debug?: { title: string; body: string };
}

interface GameState {
  title: string;
  titleTokens: Token[];
  bodyTokens: Token[];
  uniqueWords: Map<string, TargetWord>;
  revealedStems: Set<string>;
  guessedStems: Set<string>;
  bestTemperature: Map<string, number>;
  guesses: GuessRecord[];
}

let globalVectors: VectorMap | null = null;
let devMode = false;
const games = new Map<string, GameState>();

export function initGameModule(vectors: VectorMap, options: { devMode?: boolean } = {}): void {
  globalVectors = vectors;
  devMode = options.devMode ?? false;
}

function requireVectors(): VectorMap {
  if (!globalVectors) throw new Error("Game module not initialized with word vectors");
  return globalVectors;
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
    bestTemperature: new Map(),
    guesses: [],
  };

  const gameId = crypto.randomUUID();
  games.set(gameId, state);

  return { gameId, view: buildView(state) };
}

function buildTemplate(tokens: Token[], state: GameState): WordTemplate[] {
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
    return {
      isWord: true,
      revealed: false,
      length: token.text.length,
      temperature: state.bestTemperature.get(normalized) ?? 0,
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
    titleTemplate: buildTemplate(state.titleTokens, state),
    bodyTemplate: buildTemplate(state.bodyTokens, state),
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
        const similarity = cosineSimilarity(guessVector, target.vector);
        const scaled = Math.max(0, Math.round(similarity * 100));
        const prevBest = state.bestTemperature.get(target.normalized) ?? 0;
        if (scaled > prevBest) state.bestTemperature.set(target.normalized, scaled);
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
