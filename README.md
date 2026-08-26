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

- `server/src/wikipedia.ts` pulls a random, decent-length Wikipedia article intro via the
  MediaWiki API each time a game starts.
- `server/src/wordVectors.ts` loads GloVe vectors into memory once at boot and exposes cosine
  similarity.
- `server/src/tokenizer.ts` splits text into word/punctuation tokens and stems words (via
  `natural`'s Porter stemmer) so plural/conjugated forms of a guessed word count as a match.
- `server/src/game.ts` holds all game state in memory per `gameId` — the secret words are never
  sent to the client; only reveal/temperature info per guess is.
- The client (`client/src`) renders black boxes sized to word length, grays them based on the
  best similarity temperature seen so far, and shows a sorted guess history.

## Known limitations (intentional for this MVP pass)

- Game state is in-memory only — restarting the server loses in-progress games.
- No accounts, daily shared puzzle, or leaderboard/ranking yet.
- Temperature is a simple linear rescale of cosine similarity, not the percentile-rank scoring
  the real Cemantle/Pedantle algorithm uses.
