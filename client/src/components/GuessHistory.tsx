import type { GuessRecord } from "../api";

type Bucket = "green" | "orange" | "red";

function bucketOf(g: GuessRecord): Bucket {
  if (g.matched) return "green";
  return g.temperature > 0 ? "orange" : "red";
}

const BUCKET_LABEL: Record<Bucket, string> = {
  green: "Found",
  orange: "Close",
  red: "Cold",
};

export function GuessHistory({ guesses }: { guesses: GuessRecord[] }) {
  if (guesses.length === 0) {
    return <p className="guess-history__empty">Your guesses will show up here, hottest first.</p>;
  }

  return (
    <ol className="guess-history">
      {guesses.map((g) => {
        const bucket = bucketOf(g);
        return (
          <li key={g.guessNumber} className={`guess guess--${bucket}`}>
            <span className="guess__number">#{g.guessNumber}</span>
            <span className="guess__word">{g.word}</span>
            <span className="guess__status">{BUCKET_LABEL[bucket]}</span>
          </li>
        );
      })}
    </ol>
  );
}
