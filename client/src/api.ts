export type WordTemplate =
  | { isWord: false; text: string }
  | { isWord: true; revealed: true; text: string }
  | {
      isWord: true;
      revealed: false;
      length: number;
      temperature: number;
      hintText?: string;
    };

export interface GuessRecord {
  word: string;
  temperature: number;
  guessNumber: number;
  matched: boolean;
}

export interface GameView {
  titleTemplate: WordTemplate[];
  bodyTemplate: WordTemplate[];
  guesses: GuessRecord[];
  gameWon: boolean;
  debug?: { title: string; body: string };
}

export interface NewGameResponse extends GameView {
  gameId: string;
}

export interface GuessResponse extends GameView {
  alreadyGuessed: boolean;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function startNewGame(): Promise<NewGameResponse> {
  return fetch("/api/game/new", { method: "POST" }).then((res) => handle(res));
}

export function submitGuess(gameId: string, guess: string): Promise<GuessResponse> {
  return fetch("/api/game/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, guess }),
  }).then((res) => handle(res));
}
