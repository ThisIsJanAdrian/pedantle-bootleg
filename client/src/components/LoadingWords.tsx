import { useEffect, useState } from "react";

const LOADING_WORDS = [
  "Photosynthesizing",
  "Foraging",
  "Percolating",
  "Cooking",
  "Untangling",
  "Cross-referencing",
  "Deliberating",
  "Deep-frying",
  "Contemplating",
  "Skimming",
  "Sifting",
  "Discombobulating",
  "Digesting",
  "Parsing",
  "Wandering",
  "Excavating",
  "Puzzling",
  "Seeking",
  "Searching",
  "Combing",
  "Thinking",
  "Thingamabobbing",
  "Hunting",
  "Formulating",
  "Tinkering",
  "Researching",
  "Investigating",
  "Scrutinizing",
  "Analyzing",
  "Speculating",
  "Reflecting",
  "Exploring",
  "Examining",
  "Interpreting",
  "Deciphering",
  "Observing",
  "Overthinking",
  "Over-overthinking",
];

// Dot count per tick, one full ramp up and back down before the word changes:
// "" -> "." -> ".." -> "..." -> ".." -> "." -> "" -> (new word) -> "" -> ...
const DOT_COUNTS = [0, 1, 2, 3, 2, 1, 0];

const INTERVAL_MS = 180;

function randomWord(exclude: string): string {
  let word = exclude;
  while (word === exclude) {
    word = LOADING_WORDS[Math.floor(Math.random() * LOADING_WORDS.length)];
  }
  return word;
}

interface LoadingState {
  word: string;
  step: number;
}

// A new word is only picked once the dot ramp completes a full cycle back to step 0 —
// kept as one state object (rather than separate word/step state) so the swap and the
// ramp reset always land on the same tick.
function nextLoadingState(prev: LoadingState): LoadingState {
  const step = (prev.step + 1) % DOT_COUNTS.length;
  return { word: step === 0 ? randomWord(prev.word) : prev.word, step };
}

export function LoadingWords() {
  const [state, setState] = useState<LoadingState>(() => ({ word: randomWord(""), step: 0 }));

  useEffect(() => {
    const timer = setInterval(() => setState(nextLoadingState), INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <p className="loading-words">
      {/* key={word} forces a remount on every swap so the fade-in animation replays */}
      <span key={state.word} className="loading-words__word">
        {state.word}
      </span>
      <span className="loading-words__ellipsis">{".".repeat(DOT_COUNTS[state.step])}</span>
    </p>
  );
}
