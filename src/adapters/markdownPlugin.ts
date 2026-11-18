import { MatchingEngine } from '../core/matchingEngine';
import { ExtensionConfig, KeywordRule } from '../core/types';
import { ThemeManager } from '../managers/themeManager';

// @CORE: Apply the current configured keyword matcher to Markdown text tokens
// @TODO: Test and verify preview rendering, sanitization, rule changes, and preserved Markdown constructs
function safeColor(value: string | undefined, fallback: string): string {
  return value && /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.% ,/+-]+\))$/i.test(value)
    ? value
    : fallback;
}

function safeRadius(value: string | undefined): string {
  return value && /^\d{1,3}(?:\.\d{1,2})?(?:px|em|rem|%)$/.test(value) ? value : '2px';
}

function safeRule(rule: KeywordRule): KeywordRule {
  return {
    ...rule,
    backgroundColor: safeColor(rule.backgroundColor, '#DC2626'),
    color: rule.color === 'auto' ? '#FFFFFF' : safeColor(rule.color, '#FFFFFF'),
    borderColor: rule.borderColor ? safeColor(rule.borderColor, '') : undefined,
    fontWeight: rule.fontWeight === 'normal' ? 'normal' : 'bold',
    fontStyle: rule.fontStyle === 'italic' ? 'italic' : 'normal',
    borderRadius: safeRadius(rule.borderRadius),
  };
}

// @CORE: VS Code Markdown API plugin entry point; returns the supplied markdown-it instance
// @TODO: Test and verify escaped HTML, inline code, links, lists, and live configuration refresh
export function keywordHighlighterMarkdownPlugin(md: any, getState: () => { config: ExtensionConfig; engine: MatchingEngine; theme: ThemeManager }): any {
  md.core.ruler.push('keyword_highlighter', (state: any) => {
    const { config, engine, theme } = getState();
    if (!config.enabled || !config.markdownPreview) {
      return;
    }

    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      const children: any[] = [];
      for (const token of block.children) {
        // Only text tokens are changed. Code, links, and existing inline markup retain their token structure.
        if (token.type !== 'text' || !token.content) {
          children.push(token);
          continue;
        }
        const content: string = token.content;
        const matches = engine.findMatches(content);
        if (!matches.length) {
          children.push(token);
          continue;
        }
        let offset = 0;
        for (const match of matches) {
          if (match.startIndex > offset) {
            const before = new state.Token('text', '', 0);
            before.content = content.slice(offset, match.startIndex);
            children.push(before);
          }
          const rule = safeRule(match.rule);
          if (config.adaptiveContrast && match.rule.color === 'auto') {
            rule.color = theme.resolveForegroundColor(rule.backgroundColor, 'auto');
          }
          const styles = [
            `background-color:${rule.backgroundColor}`,
            `color:${rule.color}`,
            `font-weight:${rule.fontWeight}`,
            `font-style:${rule.fontStyle}`,
            `border-radius:${rule.borderRadius}`,
            ...(rule.borderColor ? [`border:1px solid ${rule.borderColor}`] : []),
            'padding:1px 3px',
          ].join(';');
          const open = new state.Token('html_inline', '', 0);
          open.content = `<span class="keyword-highlight" style="${styles}">`;
          children.push(open);
          const highlighted = new state.Token('text', '', 0);
          highlighted.content = match.matchedText;
          children.push(highlighted);
          const close = new state.Token('html_inline', '', 0);
          close.content = '</span>';
          children.push(close);
          offset = match.endIndex;
        }
        if (offset < content.length) {
          const after = new state.Token('text', '', 0);
          after.content = content.slice(offset);
          children.push(after);
        }
      }
      block.children = children;
    }
  });
  return md;
}
