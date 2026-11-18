export type CommentRange = { startIndex: number; endIndex: number };

type LanguageComments = {
  line?: string[];
  block?: [string, string][];
  quotes?: string[];
  tripleQuotes?: string[];
  markup?: boolean;
};

const C_STYLE: LanguageComments = {
  line: ['//'],
  block: [['/*', '*/']],
  quotes: ['"', "'", '`'],
};

const LANGUAGES: Record<string, LanguageComments> = {};
function register(ids: string[], config: LanguageComments): void {
  for (const id of ids) LANGUAGES[id] = config;
}

register(['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'java', 'c', 'cpp', 'csharp', 'go', 'swift', 'kotlin', 'scala', 'objective-c', 'objective-cpp', 'dart'], C_STYLE);
register(['rust'], { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"] });
register(['php'], { line: ['//', '#'], block: [['/*', '*/']], quotes: ['"', "'", '`'] });
register(['css', 'scss', 'less'], { block: [['/*', '*/']], quotes: ['"', "'"] });
register(['python', 'python3'], { line: ['#'], block: [], quotes: ['"', "'"], tripleQuotes: ['"""', "'''"] });
register(['shellscript', 'bash', 'zsh', 'ruby', 'yaml', 'toml', 'r', 'perl', 'makefile', 'dockerfile'], { line: ['#'], quotes: ['"', "'", '`'] });
register(['sql', 'mysql', 'pgsql', 'plsql'], { line: ['--'], block: [['/*', '*/']], quotes: ["'", '"', '`'] });
register(['html', 'xml', 'vue', 'svelte'], { block: [['<!--', '-->']], quotes: ['"', "'"], markup: true });
register(['markdown', 'mdx'], { block: [['<!--', '-->']] });
register(['lua'], { line: ['--'], block: [['--[[', ']]']], quotes: ['"', "'"] });
register(['haskell'], { line: ['--'], block: [['{-', '-}']], quotes: ['"', "'"] });
/**
 * Supported IDs: JavaScript/TypeScript and JSX/TSX, Java, C/C++/C#, Go, Rust,
 * Swift, Kotlin, Scala, Objective-C, PHP, Dart, CSS/SCSS/Less, Python, shell,
 * Ruby, YAML, TOML, R, Perl, Makefile, Dockerfile, SQL variants, HTML/XML,
 * Markdown/MDX, Vue/Svelte, Lua, and Haskell.
 * This lightweight lexer does not parse nested block comments, language-specific
 * raw strings, JavaScript regex literals, or template interpolation. Markdown
 * comment markers inside code fences are recognized. Rust apostrophes only begin
 * character strings when a closing apostrophe occurs on that line.
 * @CORE: Identify comment spans while excluding quoted strings for supported languages.
 * @TODO: Test and verify language aliases, escaped delimiters, nested constructs, and malformed input recovery.
 */
export function findCommentRanges(text: string, languageId: string): readonly CommentRange[] {
  const normalizedId = languageId.toLowerCase();
  const config = Object.prototype.hasOwnProperty.call(LANGUAGES, normalizedId)
    ? LANGUAGES[normalizedId]
    : undefined;
  if (!config || !text) return [];
  const ranges: CommentRange[] = [];
  let i = 0;
  let inMarkupTag = false;
  while (i < text.length) {
    if (config.markup) {
      if (text[i] === '<') inMarkupTag = true;
      else if (text[i] === '>') inMarkupTag = false;
    }
    const triple = config.tripleQuotes?.find((q) => text.startsWith(q, i));
    if (triple) {
      i += triple.length;
      while (i < text.length) {
        if (text.startsWith(triple, i)) { i += triple.length; break; }
        if (text[i] === '\\') i += Math.min(2, text.length - i);
        else i++;
      }
      continue;
    }

    let quote = (config.markup && !inMarkupTag ? [] : config.quotes)?.find((q) => text.startsWith(q, i));
    if (normalizedId === 'rust' && quote === "'") {
      const charLiteral = /^'(?:[^'\\\r\n]|\\(?:.|u\{[0-9A-Fa-f_]+\}))'/u.test(text.slice(i));
      if (!charLiteral) quote = undefined;
    }
    if (quote) {
      i += quote.length;
      while (i < text.length) {
        if (text[i] === '\\') { i += Math.min(2, text.length - i); continue; }
        if (text.startsWith(quote, i)) {
          // Common doubled quote escaping in SQL and similar languages.
          if (text.startsWith(quote + quote, i)) { i += quote.length * 2; continue; }
          i += quote.length;
          break;
        }
        if ((quote === '"' || quote === "'") && (text[i] === '\n' || text[i] === '\r')) break;
        i++;
      }
      continue;
    }

    const block = config.block?.find(([open]) => text.startsWith(open, i));
    if (block) {
      const [open, close] = block;
      const startIndex = i;
      i += open.length;
      const closeAt = text.indexOf(close, i);
      if (closeAt < 0) { ranges.push({ startIndex, endIndex: text.length }); break; }
      i = closeAt + close.length;
      ranges.push({ startIndex, endIndex: i });
      continue;
    }

    const line = config.line?.find((marker) => text.startsWith(marker, i));
    if (line) {
      const startIndex = i;
      const endIndex = findLineEnd(text, i + line.length);
      ranges.push({ startIndex, endIndex });
      i = endIndex;
      continue;
    }
    i++;
  }
  return ranges;
}

function findLineEnd(text: string, fromIndex: number): number {
  let i = fromIndex;
  while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
  return i;
}
