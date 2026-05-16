/**
 * Wire format for an in-chat quote — matches browser_use_cloud's user-message
 * encoding (minus the [scroll:N] metadata line). A user_input event whose
 * content starts with consecutive `> ` lines, followed by a blank line, then
 * prose, is split into `{ quote, message }`.
 *
 *   > First line of quote
 *   > Second line
 *
 *   User's actual reply here.
 */

export interface ParsedUserMessage {
  quote: string | null;
  message: string;
}

export function parseUserMessage(content: string): ParsedUserMessage {
  const lines = content.split('\n');
  const quoteLines: string[] = [];
  let i = 0;
  while (i < lines.length && lines[i].startsWith('> ')) {
    quoteLines.push(lines[i].slice(2));
    i++;
  }
  if (quoteLines.length === 0) return { quote: null, message: content };
  // Allow an optional single blank-line separator between quote and message.
  if (i < lines.length && lines[i] === '') i++;
  const message = lines.slice(i).join('\n');
  return { quote: quoteLines.join('\n'), message };
}

/**
 * Inverse — prepend a quote to the user's message in the canonical wire form.
 */
export function formatUserMessageWithQuote(quote: string | null, message: string): string {
  if (!quote) return message;
  const quoteBlock = quote
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  return message ? `${quoteBlock}\n\n${message}` : quoteBlock;
}
