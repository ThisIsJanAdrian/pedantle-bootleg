import natural from "natural";

const { PorterStemmer } = natural;

export interface Token {
  text: string;
  isWord: boolean;
}

// Unicode-aware so accented/other-script words (e.g. "café", "Müller") stay a single
// token instead of splitting at the first non-ASCII letter — isAsciiFriendly() in
// wikipedia.ts is what later decides whether such a word is guessable.
const TOKEN_RE = /[\p{L}\p{N}']+|[^\p{L}\p{N}']+/gu;

export function tokenize(text: string): Token[] {
  const matches = text.match(TOKEN_RE) ?? [];
  return matches.map((text) => ({ text, isWord: /[\p{L}\p{N}]/u.test(text) }));
}

// NFD-decompose first so accented Latin letters (é, ü, ñ, ...) split into a base letter
// plus a combining mark that the following strip removes — "café" and "cafe" both
// normalize to "cafe", so a plain ASCII guess matches the accented word in the text.
// Words in other scripts (Cyrillic, CJK, ...) have no such decomposition and normalize
// to "", which buildUniqueWords treats as unguessable — they stay in the text but can
// never be revealed.
export function normalizeWord(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function stemWord(word: string): string {
  const normalized = normalizeWord(word);
  return normalized ? PorterStemmer.stem(normalized) : "";
}
