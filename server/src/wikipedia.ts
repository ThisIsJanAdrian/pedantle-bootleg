import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_URL = "https://en.wikipedia.org/w/api.php";
const MIN_TOTAL_WORDS = 300;
const MAX_ATTEMPTS = 30;
const MAX_TOTAL_MS = 20000;
const MAX_RATE_LIMIT_BACKOFF_MS = 5000;
const WORD_LIST_PATH =
  process.env.WORD_LIST_PATH ?? path.join(__dirname, "..", "data", "commonWords.txt");

// Candidate secret words: common, everyday-knowledge nouns rather than truly random Wikipedia
// pages. Plain `generator=random` skews heavily toward obscure people/places/sports-seasons
// that are nearly unguessable; picking from this curated pool and looking each one up as a
// page title (with redirects followed) keeps the puzzle in the spirit of the real Pedantle,
// where the secret is always "a relatively common word everyone should know."
const WORD_LIST: string[] = fs
  .readFileSync(WORD_LIST_PATH, "utf-8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

function shuffledWords(): string[] {
  const words = [...WORD_LIST];
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words;
}

// Sections past this point are link dumps / metadata, not prose — stop accumulating there.
const STOP_HEADINGS = new Set([
  "references",
  "see also",
  "external links",
  "notes",
  "further reading",
  "bibliography",
  "gallery",
  "works cited",
  "citations",
  "sources",
  "footnotes",
]);

// Basic Latin letters/digits/punctuation, plus the handful of "smart" typographic
// and currency characters Wikipedia extracts commonly use (en/em dash, curly quotes,
// ellipsis, £/€/¥/°). Anything else (accented Latin, other scripts) fails this. Only the
// title is required to pass it wholesale (see fetchOneCandidate) — the game module runs
// this per-word over the body to decide which words are eligible to be guessed/revealed.
const ALLOWED_CHARS_RE = /^[\x20-\x7E\n–—‘’“”…!#%&()$£€¥°]*$/;

export interface WikiArticle {
  title: string;
  introText: string;
}

interface QueryResponse {
  query?: {
    pages?: Array<{
      title: string;
      extract?: string;
      pageprops?: { disambiguation?: string };
    }>;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAsciiFriendly(text: string): boolean {
  return ALLOWED_CHARS_RE.test(text);
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// MediaWiki's `extracts` API strips IPA pronunciation and audio-link templates
// (e.g. `{{IPAc-en|...}}`, `{{Audio|...}}`) but leaves their surrounding parens and
// separator punctuation behind — "Mayonnaise ({{IPAc-en|...}})" becomes "Mayonnaise ()"
// instead of just "Mayonnaise". Strip any parenthetical that's left with nothing but
// whitespace/commas/semicolons in it (plus the space before it), so it reads clean.
const EMPTY_PAREN_RE = /\s*\([\s,;]*\)/g;

function cleanExtractText(text: string): string {
  return text.replace(EMPTY_PAREN_RE, "");
}

/**
 * Walk the full plaintext extract (with wiki-style == headings ==) and accumulate whole
 * paragraphs — never a partial one — until we have at least MIN_TOTAL_WORDS words, stopping
 * early if we hit a non-prose section (References, See also, ...). Returns null if the
 * article runs out of usable prose before reaching the target.
 */
function selectIntro(fullExtract: string): string | null {
  // MediaWiki doesn't consistently put a blank line between a heading and its first paragraph
  // (subsections in particular are often joined by a single \n), so headings must be detected
  // line-by-line rather than by grouping on blank-line-separated blocks first.
  const lines = fullExtract
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const collected: string[] = [];
  let wordCount = 0;

  for (const line of lines) {
    const headingMatch = /^=+\s*(.+?)\s*=+$/.exec(line);
    if (headingMatch) {
      if (STOP_HEADINGS.has(headingMatch[1].trim().toLowerCase())) break;
      continue;
    }

    collected.push(line);
    wordCount += countWords(line);
    if (wordCount >= MIN_TOTAL_WORDS) break;
  }

  return wordCount >= MIN_TOTAL_WORDS ? collected.join("\n\n") : null;
}

async function fetchOneCandidate(word: string): Promise<WikiArticle | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    titles: word,
    redirects: "1",
    prop: "extracts|pageprops",
    explaintext: "1",
    exsectionformat: "wiki",
    ppprop: "disambiguation",
  });

  const res = await fetch(`${API_URL}?${params.toString()}`, {
    headers: { "User-Agent": "pedantle-bootleg/0.1 (personal side project)" },
  });
  if (res.status === 429) {
    const retryAfterMs = (Number(res.headers.get("retry-after")) || 1) * 1000;
    if (process.env.WIKI_DEBUG)
      console.log("[wiki] 429 rate limited, retry-after header:", res.headers.get("retry-after"));
    await sleep(Math.min(retryAfterMs, MAX_RATE_LIMIT_BACKOFF_MS));
    return null;
  }
  if (!res.ok) {
    throw new Error(`Wikipedia API request failed: ${res.status}`);
  }

  const data = (await res.json()) as QueryResponse;
  const page = data.query?.pages?.[0];
  if (!page || !page.extract) {
    if (process.env.WIKI_DEBUG) console.log("[wiki] no page/extract");
    return null;
  }
  if (page.pageprops?.disambiguation !== undefined) {
    if (process.env.WIKI_DEBUG) console.log("[wiki] reject disambiguation:", page.title);
    return null;
  }
  if (page.title.toLowerCase().startsWith("list of")) {
    if (process.env.WIKI_DEBUG) console.log("[wiki] reject list-of:", page.title);
    return null;
  }

  const introText = selectIntro(cleanExtractText(page.extract));
  if (!introText) {
    if (process.env.WIKI_DEBUG) console.log("[wiki] reject too-short:", page.title);
    return null;
  }
  if (!isAsciiFriendly(page.title)) {
    if (process.env.WIKI_DEBUG) console.log("[wiki] reject non-ascii title:", page.title);
    return null;
  }

  if (process.env.WIKI_DEBUG) console.log("[wiki] accept:", page.title);
  return { title: page.title, introText };
}

export async function fetchRandomArticle(): Promise<WikiArticle> {
  const candidates = shuffledWords().slice(0, MAX_ATTEMPTS);
  const startedAt = Date.now();

  for (let attempt = 0; attempt < candidates.length; attempt++) {
    if (Date.now() - startedAt > MAX_TOTAL_MS) break;
    if (attempt > 0) await sleep(250);
    const article = await fetchOneCandidate(candidates[attempt]);
    if (article) return article;
  }
  throw new Error("Could not find a usable Wikipedia article after several attempts");
}
