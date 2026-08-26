import natural from "natural";

const { PorterStemmer } = natural;

export interface Token {
  text: string;
  isWord: boolean;
}

const TOKEN_RE = /[A-Za-z0-9']+|[^A-Za-z0-9']+/g;

export function tokenize(text: string): Token[] {
  const matches = text.match(TOKEN_RE) ?? [];
  return matches.map((text) => ({ text, isWord: /[A-Za-z0-9]/.test(text) }));
}

export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function stemWord(word: string): string {
  const normalized = normalizeWord(word);
  return normalized ? PorterStemmer.stem(normalized) : "";
}
