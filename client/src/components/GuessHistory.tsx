import type { GuessRecord } from "../api";

export function GuessHistory({ guesses }: { guesses: GuessRecord[] }) {
  if (guesses.length === 0) {
    return <p className="guess-history__empty">Your guesses will show up here, hottest first.</p>;
  }

  return (
    <ol className="guess-history">
      {guesses.map((g) => (
        <li key={g.guessNumber} className={g.matched ? "guess guess--matched" : "guess"}>
          <span className="guess__number">#{g.guessNumber}</span>
          <span className="guess__word">{g.word}</span>
          <span className="guess__temperature">{g.matched ? "found" : `${g.temperature}°`}</span>
        </li>
      ))}
    </ol>
  );
}
