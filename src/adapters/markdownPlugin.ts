// @CORE: Markdown-it plugin extending VS Code built-in Markdown preview with keyword highlighting
// @TODO: Test and verify headings, lists, tables, blockquotes, code fences, and inline code spans

interface RuleConfig {
  text: string;
  backgroundColor: string;
  color: string;
  fontWeight: string;
  fontStyle: string;
  borderRadius: string;
  borderColor?: string;
}

const DEFAULT_MARKDOWN_RULES: RuleConfig[] = [
  {
    text: '@TODO:',
    backgroundColor: '#DC2626',
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontStyle: 'normal',
    borderRadius: '2px',
  },
  {
    text: '@CORE:',
    backgroundColor: '#2563EB',
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontStyle: 'normal',
    borderRadius: '2px',
  },
];

// @CORE: Escape special regex characters in literal keywords
// @TODO: Test and verify punctuation characters in keyword strings
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// @CORE: Main markdown-it plugin entry point contributing to VS Code Markdown preview
// @TODO: Test and verify security boundaries, preserving HTML sanitation, and performance in long markdown docs
export default function keywordHighlighterMarkdownPlugin(md: any): any {
  md.core.ruler.push('keyword_highlighter', (state: any) => {
    const rules = DEFAULT_MARKDOWN_RULES;
    if (!rules || rules.length === 0) {
      return;
    }

    const patternString = rules.map((r) => escapeRegex(r.text)).join('|');
    const regex = new RegExp(`(${patternString})`, 'g');

    for (const blockToken of state.tokens) {
      if (blockToken.type !== 'inline' || !blockToken.children) {
        continue;
      }

      const newChildren: any[] = [];

      for (const token of blockToken.children) {
        if (token.type !== 'text' || !token.content) {
          newChildren.push(token);
          continue;
        }

        const content: string = token.content;
        regex.lastIndex = 0;

        let lastIndex = 0;
        let match: RegExpExecArray | null;
        let hasMatches = false;

        while ((match = regex.exec(content)) !== null) {
          hasMatches = true;
          const matchStart = match.index;
          const matchEnd = matchStart + match[0].length;

          if (matchStart > lastIndex) {
            const beforeToken = new state.Token('text', '', 0);
            beforeToken.content = content.slice(lastIndex, matchStart);
            newChildren.push(beforeToken);
          }

          const matchedWord = match[0];
          const matchedRule =
            rules.find((r) => r.text === matchedWord) || rules[0];

          const openSpan = new state.Token('html_inline', '', 0);
          const style = [
            `background-color: ${matchedRule.backgroundColor}`,
            `color: ${matchedRule.color}`,
            `font-weight: ${matchedRule.fontWeight}`,
            `font-style: ${matchedRule.fontStyle}`,
            `border-radius: ${matchedRule.borderRadius}`,
            'padding: 1px 3px',
            'display: inline-block',
          ].join('; ');
          openSpan.content = `<span class="keyword-highlight" style="${style}">`;
          newChildren.push(openSpan);

          const keywordToken = new state.Token('text', '', 0);
          keywordToken.content = matchedWord;
          newChildren.push(keywordToken);

          const closeSpan = new state.Token('html_inline', '', 0);
          closeSpan.content = '</span>';
          newChildren.push(closeSpan);

          lastIndex = matchEnd;
        }

        if (hasMatches) {
          if (lastIndex < content.length) {
            const afterToken = new state.Token('text', '', 0);
            afterToken.content = content.slice(lastIndex);
            newChildren.push(afterToken);
          }
        } else {
          newChildren.push(token);
        }
      }

      blockToken.children = newChildren;
    }
  });

  return md;
}

// Support both CommonJS require(plugin) and require(plugin).default in VS Code markdown-it loaders
module.exports = keywordHighlighterMarkdownPlugin;
module.exports.default = keywordHighlighterMarkdownPlugin;
