import { useEffect, useState } from "react";
import type { WordTemplate } from "../api";

const PEEK_DURATION_MS = 1500;

// 0-99 score -> 0-49.5% opacity; a full match never reaches here (it's rendered as
// revealed text instead), so the ghost text never fully resolves into a plain reveal.
function hintOpacity(temperature: number): number {
  return Math.min(temperature, 99) * 0.005;
}

export function WordBox({
  token,
  gradeable,
}: {
  token: Extract<WordTemplate, { isWord: true }>;
  gradeable: boolean;
}) {
  const [peeking, setPeeking] = useState(false);
  const peekText = token.revealed ? undefined : token.peekText;

  // peekText only exists once the game is already won (server-gated, see game.ts) — if a
  // still-hidden box stops being peekable (shouldn't normally happen mid-peek, but guards
  // against it), drop out of the peeking state rather than get stuck showing it.
  useEffect(() => {
    if (!peeking) return;
    if (!peekText) {
      setPeeking(false);
      return;
    }
    const timer = setTimeout(() => setPeeking(false), PEEK_DURATION_MS);
    return () => clearTimeout(timer);
  }, [peeking, peekText]);

  if (token.revealed) {
    return <span className="word word--revealed">{token.text}</span>;
  }

  if (peeking && peekText) {
    return <span className="word word--revealed word--peeking">{peekText}</span>;
  }

  const showHint = gradeable && !!token.hintText;
  // Widen the box to fit whichever is longer, the secret word or the ghosted guess —
  // otherwise a long guess ghosting onto a short hidden word clips into an illegible
  // fragment instead of overflowing visibly. Shrinks back down once a shorter guess
  // becomes the best match.
  const widthChars = showHint ? Math.max(token.length, token.hintText!.length) : token.length;
  const peekable = !!peekText;

  return (
    <span
      className={peekable ? "word word--hidden word--peekable" : "word word--hidden"}
      style={{ width: `${widthChars * 0.7}em` }}
      title={peekable ? "Click to peek" : `${token.length} letters`}
      onClick={peekable ? () => setPeeking(true) : undefined}
    >
      {showHint && (
        <span className="word__hint" style={{ opacity: hintOpacity(token.temperature) }}>
          {token.hintText}
        </span>
      )}
    </span>
  );
}
