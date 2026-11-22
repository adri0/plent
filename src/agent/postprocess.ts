// Turns the model's text into a WhatsApp message: stray Markdown converted to WhatsApp's own
// formatting, and the length capped.

export const MAX_REPLY_LENGTH = 600;

export function toWhatsApp(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/```[a-z]*\n?/gi, '') // code fences
    .split('\n')
    .map(convertLine);
  const joined = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return capLength(joined, MAX_REPLY_LENGTH);
}

function convertLine(line: string): string {
  let out = line.replace(/[ \t]+$/, '');
  // Headings become bold lines.
  out = out.replace(/^#{1,6}\s+(.+)$/, (_m, title: string) => `*${title.replace(/\*+/g, '')}*`);
  // Bullets: "- x", "* x", "+ x" → "• x".
  out = out.replace(/^(\s*)[-*+]\s+/, (_m, indent: string) => `${indent}• `);
  // Bold: **x** or __x__ → *x*. Italic stays _x_ (WhatsApp's own).
  out = out.replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/__(.+?)__/g, '*$1*');
  // Strikethrough: ~~x~~ → ~x~.
  out = out.replace(/~~(.+?)~~/g, '~$1~');
  // Links: [text](url) → text (url).
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)');
  // Inline code: `x` → x.
  out = out.replace(/`([^`]+)`/g, '$1');
  return out;
}

// Cuts at the last line or sentence end that fits, else the last word, and adds an ellipsis.
export function capLength(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const breaks = [
    room.lastIndexOf('\n'),
    ...['. ', '! ', '? '].map((p) => room.lastIndexOf(p) + 1),
  ];
  const cut = Math.max(...breaks);
  if (cut > max / 2) return `${room.slice(0, cut).trimEnd()} …`.slice(0, max);
  const word = room.lastIndexOf(' ');
  return `${room.slice(0, word > 0 ? word : room.length).trimEnd()}…`;
}
