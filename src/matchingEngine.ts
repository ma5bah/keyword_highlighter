import { KeywordRule, KeywordMatch } from './types';

// @CORE: Standalone, UI-independent keyword matching engine
// @TODO: Test and verify exact literal matching, whole-word flags, regex safety, and deterministic overlap arbitration
export class MatchingEngine {
  private rules: KeywordRule[] = [];
  private compiledRules: { rule: KeywordRule; regex: RegExp }[] = [];
  private globalCaseSensitive: boolean = true;

  constructor(rules: KeywordRule[] = [], globalCaseSensitive: boolean = true) {
    this.updateRules(rules, globalCaseSensitive);
  }

  // @CORE: Compile rules into safe regular expressions with validation
  // @TODO: Test and verify malformed regular expressions, empty patterns, and catastrophic backtracking avoidance
  public updateRules(rules: KeywordRule[], globalCaseSensitive: boolean = true): void {
    this.rules = rules.filter((r) => r.enabled && r.text && r.text.length > 0);
    this.globalCaseSensitive = globalCaseSensitive;
    this.compiledRules = [];

    for (const rule of this.rules) {
      try {
        const regex = this.compileRuleRegex(rule, this.globalCaseSensitive);
        if (regex) {
          this.compiledRules.push({ rule, regex });
        }
      } catch (err) {
        // Gracefully ignore invalid regex rules
        console.error(`KeywordHighlighter: Invalid pattern for rule "${rule.text}":`, err);
      }
    }
  }

  // @CORE: Construct regex safely distinguishing literal keywords from custom regular expressions
  // @TODO: Test and verify special characters (@, :, /, $, ^, *, +, ?, (, )) and wholeWord boundaries
  private compileRuleRegex(rule: KeywordRule, globalCaseSensitive: boolean): RegExp | null {
    let pattern = rule.text;

    if (!rule.isRegex) {
      // Escape special regex characters for literal matching
      pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    if (rule.wholeWord) {
      // If the keyword starts/ends with word characters, use \b, otherwise use lookarounds
      const startsWithWord = /^\w/.test(pattern);
      const endsWithWord = /\w$/.test(pattern);
      const prefix = startsWithWord ? '\\b' : '(?<=^|\\s|[.,;!?()\\[\\]{}])';
      const suffix = endsWithWord ? '\\b' : '(?=$|\\s|[.,;!?()\\[\\]{}])';
      pattern = `${prefix}${pattern}${suffix}`;
    }

    const flags = globalCaseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  }

  // @CORE: Scan document text and extract all keyword matches with line/char coordinates
  // @TODO: Test and verify zero-length match avoidance, multibyte UTF-8/UTF-16 characters, and CRLF line breaks
  public findMatches(text: string): KeywordMatch[] {
    if (!text || this.compiledRules.length === 0) {
      return [];
    }

    // Precalculate line start offsets for efficient index -> (line, char) conversion
    const lineStarts: number[] = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        lineStarts.push(i + 1);
      }
    }

    const rawMatches: {
      rule: KeywordRule;
      startIndex: number;
      endIndex: number;
      matchedText: string;
      ruleIndex: number;
    }[] = [];

    for (let ruleIndex = 0; ruleIndex < this.compiledRules.length; ruleIndex++) {
      const { rule, regex } = this.compiledRules[ruleIndex];
      // Reset regex state
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const matchedText = match[0];
        // Guard against zero-length matches creating infinite loops
        if (matchedText.length === 0) {
          regex.lastIndex++;
          continue;
        }

        const startIndex = match.index;
        const endIndex = startIndex + matchedText.length;

        rawMatches.push({
          rule,
          startIndex,
          endIndex,
          matchedText,
          ruleIndex,
        });

        // Ensure we advance if regex engine didn't
        if (regex.lastIndex === startIndex) {
          regex.lastIndex++;
        }
      }
    }

    // Resolve overlaps deterministically:
    // 1. Higher priority first
    // 2. Longest match length first
    // 3. Earliest defined rule order (ruleIndex asc)
    const resolvedRaw = this.resolveOverlaps(rawMatches);

    // Convert raw index matches to KeywordMatch with line/char
    return resolvedRaw.map((m) => {
      const startPos = this.indexToPosition(m.startIndex, lineStarts);
      const endPos = this.indexToPosition(m.endIndex, lineStarts);

      return {
        rule: m.rule,
        startIndex: m.startIndex,
        endIndex: m.endIndex,
        startLine: startPos.line,
        startChar: startPos.character,
        endLine: endPos.line,
        endChar: endPos.character,
        matchedText: m.matchedText,
      };
    });
  }

  // @CORE: Deterministic overlap resolution across matched candidate spans
  // @TODO: Test and verify exact priority ties, sub-span overlaps, and adjacent non-overlapping spans
  private resolveOverlaps<
    T extends {
      rule: KeywordRule;
      startIndex: number;
      endIndex: number;
      ruleIndex: number;
    }
  >(matches: T[]): T[] {
    if (matches.length <= 1) {
      return matches;
    }

    // Sort candidates according to SRS priority rules:
    // Priority (descending) -> Length (descending) -> Rule order (ascending) -> Start index (ascending)
    matches.sort((a, b) => {
      const pDiff = (b.rule.priority || 0) - (a.rule.priority || 0);
      if (pDiff !== 0) {
        return pDiff;
      }

      const lenDiff = (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
      if (lenDiff !== 0) {
        return lenDiff;
      }

      const orderDiff = a.ruleIndex - b.ruleIndex;
      if (orderDiff !== 0) {
        return orderDiff;
      }

      return a.startIndex - b.startIndex;
    });

    const accepted: T[] = [];

    for (const candidate of matches) {
      // Check collision with already accepted non-overlapping regions
      const overlaps = accepted.some(
        (acc) => candidate.startIndex < acc.endIndex && candidate.endIndex > acc.startIndex
      );

      if (!overlaps) {
        accepted.push(candidate);
      }
    }

    // Return in document appearance order (startIndex ascending)
    return accepted.sort((a, b) => a.startIndex - b.startIndex);
  }

  // @CORE: Map 0-based character index to line and column character offset
  // @TODO: Test and verify document boundaries, trailing newlines, and single-line documents
  private indexToPosition(
    index: number,
    lineStarts: number[]
  ): { line: number; character: number } {
    let low = 0;
    let high = lineStarts.length - 1;
    let line = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (lineStarts[mid] <= index) {
        line = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const character = index - lineStarts[line];
    return { line, character };
  }
}
