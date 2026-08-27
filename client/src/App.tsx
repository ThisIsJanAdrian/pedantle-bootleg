import { useEffect, useRef, useState } from "react";
import { startNewGame, submitGuess, type GameView } from "./api";
import { Paragraph } from "./components/Paragraph";
import { GuessHistory } from "./components/GuessHistory";
import { LoadingWords } from "./components/LoadingWords";

export function App() {
  const [gameId, setGameId] = useState<string | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [guessInput, setGuessInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped on every call so a stale response (e.g. from React StrictMode's dev-only double
  // mount, which fires this effect twice and starts two /api/game/new requests) can tell
  // it's no longer the latest and skip updating state — whichever response actually wins
  // the race, only the most recently *started* request's result is ever applied.
  const requestIdRef = useRef(0);

  async function beginNewGame() {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await startNewGame();
      if (requestIdRef.current !== requestId) return;
      setGameId(res.gameId);
      setView(res);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "Failed to start a new game");
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }

  useEffect(() => {
    beginNewGame();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const guess = guessInput.trim();
    if (!gameId || !guess) return;
    setGuessInput("");
    setNotice(null);
    try {
      const res = await submitGuess(gameId, guess);
      setView(res);
      if (res.alreadyGuessed) setNotice(`Already tried "${guess}"`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit guess");
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>Peddie: Pedantle Bootleg</h1>
        <p className="app__subtitle">Guess the words behind the secret Wikipedia intro.</p>
      </header>

      {loading && <LoadingWords />}
      {error && (
        <p className="app__error">
          {error} <button onClick={beginNewGame}>Try again</button>
        </p>
      )}

      {view && !loading && (
        <>
          <section className="title-block">
            <Paragraph tokens={view.titleTemplate} gradeable={false} />
          </section>

          {view.gameWon && (
            <div className="win-banner">
              <strong>You found it!</strong> Solved in {view.guesses.length} guesses.
              <button onClick={beginNewGame}>Play another</button>
            </div>
          )}

          <form className="guess-form" onSubmit={handleSubmit}>
            <input
              autoFocus
              value={guessInput}
              onChange={(e) => setGuessInput(e.target.value)}
              placeholder="Type a word..."
              />
            <button type="submit">Guess</button>
          </form>
          {notice && <p className="app__notice">{notice}</p>}

          <section className="body-block">
            <Paragraph tokens={view.bodyTemplate} gradeable={true} />
          </section>

          <section className="sidebar">
            <h2>Guesses ({view.guesses.length})</h2>
            <GuessHistory guesses={view.guesses} />
          </section>

          {view.debug && (
            <details className="dev-panel">
              <summary>DEV MODE — answer key</summary>
              <p>
                <strong>Title:</strong> {view.debug.title}
              </p>
              <p className="dev-panel__body">{view.debug.body}</p>
            </details>
          )}
        </>
      )}
    </div>
  );
}
