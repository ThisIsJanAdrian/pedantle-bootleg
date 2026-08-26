import type { WordTemplate } from "../api";
import { WordBox } from "./WordBox";

export function Paragraph({
  tokens,
  gradeable,
}: {
  tokens: WordTemplate[];
  gradeable: boolean;
}) {
  return (
    <p className="paragraph">
      {tokens.map((token, i) =>
        token.isWord ? (
          <WordBox key={i} token={token} gradeable={gradeable} />
        ) : (
          <span key={i} className="word word--literal">
            {token.text}
          </span>
        )
      )}
    </p>
  );
}
