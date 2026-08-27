# Peddie: Pedantle Bootleg

A single-player clone of [Pedantle](https://pedantle.certitudes.org/): guess the words hidden in
a random Wikipedia article's intro paragraph. Correct guesses reveal every occurrence of that
word; close-but-not-quite guesses show up as a grayed box shaded by semantic similarity (GloVe
word vectors, cosine similarity — the same idea Cemantle uses). Reveal every word in the title to
win.

## One-time setup

1. `npm install` (installs both the `server` and `client` workspaces).
2. Download pretrained word vectors: get `glove.6B.zip` from the
   [GloVe project page](https://nlp.stanford.edu/projects/glove/), unzip it, and place
   `glove.6B.100d.txt` at `server/data/glove.6B.100d.txt`. This file is intentionally gitignored
   (it's ~347MB) — you need to fetch it once per machine.

## Running it

```
npm run dev
```

This starts the API server on `http://localhost:3001` and the Vite client on
`http://localhost:5173` (which proxies `/api` to the server). Open the client URL and play.

The server logs vocabulary size and load time on startup — loading the vectors takes a few
seconds and a few hundred MB of RAM.

## How it works

- `server/src/wikipedia.ts` picks the secret from `server/data/commonWords.txt` — a curated pool
  of ~550 everyday-knowledge nouns (animals, food, science concepts, everyday objects, etc.) —
  rather than a truly random Wikipedia page. Plain `generator=random` skews heavily toward
  obscure people/places/sports-seasons that are nearly unguessable; looking up a common word as a
  page title (following redirects, e.g. `panda` → `Giant panda`) keeps the puzzle in the spirit of
  the real Pedantle, where "secret words are all relatively common words ... everyone should
  know." For each candidate it accumulates whole paragraphs (lead section first, then body
  sections, skipping References/See also/External links/etc.) until it has at least 400 words —
  never cutting a paragraph in half — and rejects the candidate if the title or text contain
  anything outside basic Latin letters/digits/standard punctuation (plus common "smart"
  punctuation like en/em dashes and curly quotes), or if it resolves to a disambiguation page.
  Because of these filters, some candidates get skipped per game; this is retried automatically
  (with backoff on Wikipedia's rate limiting) against a shuffled slice of the word list, up to
  ~25 seconds before giving up, and the client shows a "Try again" button if it does. Add more
  entries to `commonWords.txt` (one per line) to grow the pool.
- `server/src/wordVectors.ts` loads GloVe vectors into memory once at boot and exposes cosine
  similarity.
- `server/src/tokenizer.ts` splits text into word/punctuation tokens and stems words (via
  `natural`'s Porter stemmer) so plural/conjugated forms of a guessed word count as a match.
- `server/src/game.ts` holds all game state in memory per `gameId` — the secret words are never
  sent to the client; only reveal/temperature info per guess is.
- The client (`client/src`) renders black boxes sized to word length, grays them based on the
  best similarity temperature seen so far, and shows a sorted guess history.

## Dev / debugging env vars

- `DEV_MODE=1` (server): every game response includes a `debug` field with the real title and
  full body text, shown in a collapsible panel at the top of the page. Guessing still works
  normally — this is just an answer key for testing, it doesn't auto-fill anything.
  ```
  DEV_MODE=1 npm run dev -w server
  ```
- `WIKI_DEBUG=1` (server): logs why each candidate random article was accepted or rejected
  (too short, non-ASCII, disambiguation, rate-limited, etc.) — useful if game creation is slow or
  failing repeatedly.

## Known limitations (intentional for this MVP pass)

- Game state is in-memory only — restarting the server loses in-progress games.
- No accounts, daily shared puzzle, or leaderboard/ranking yet.
- Temperature is a simple linear rescale of cosine similarity, not the percentile-rank scoring
  the real Cemantle/Pedantle algorithm uses.
