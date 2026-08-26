import type { WordTemplate } from "../api";

const GRAY_THRESHOLD = 15;

function boxColor(temperature: number, gradeable: boolean): string {
  if (!gradeable || temperature < GRAY_THRESHOLD) return "#141414";
  const lightness = 12 + Math.min(temperature, 99) * 0.55;
  return `hsl(0, 0%, ${lightness}%)`;
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

  return (
    <span
      className="word word--hidden"
      style={{
        width: `${token.length * 0.7}em`,
        backgroundColor: boxColor(token.temperature, gradeable),
      }}
      title={`${token.length} letters`}
    />
  );
}
