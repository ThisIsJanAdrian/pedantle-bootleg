import type { WordTemplate } from "../api";

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
  if (token.revealed) {
    return <span className="word word--revealed">{token.text}</span>;
  }

  const showHint = gradeable && !!token.hintText;
  // Widen the box to fit whichever is longer, the secret word or the ghosted guess —
  // otherwise a long guess ghosting onto a short hidden word clips into an illegible
  // fragment instead of overflowing visibly. Shrinks back down once a shorter guess
  // becomes the best match.
  const widthChars = showHint ? Math.max(token.length, token.hintText!.length) : token.length;

  return (
    <span
      className="word word--hidden"
      style={{ width: `${widthChars * 0.7}em` }}
      title={`${token.length} letters`}
    >
      {showHint && (
        <span className="word__hint" style={{ opacity: hintOpacity(token.temperature) }}>
          {token.hintText}
        </span>
      )}
    </span>
  );
}
