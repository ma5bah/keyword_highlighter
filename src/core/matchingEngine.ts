import { KeywordRule, KeywordMatch } from './types';
import { CommentRange } from './commentRanges';

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

  // @CORE: Scan document text, map match coordinates, and optionally restrict spans to complete comment ranges.
  // @TODO: Test and verify zero-length matches, UTF-16 offsets, line endings, range boundaries, empty ranges, and unfiltered matching.
  public findMatches(text: string, allowedRanges?: readonly CommentRange[]): KeywordMatch[] {
    if (!text || this.compiledRules.length === 0) {
      return [];
    }
    if (allowedRanges !== undefined && allowedRanges.length === 0) return [];

    // Precalculate line start offsets for efficient index -> (line, char) conversion
    const lineStarts: number[] = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        lineStarts.push(i + 1);
      } else if (text[i] === '\r' && text[i + 1] !== '\n') {
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
      regex.lastIndex = 0;
      let allowedRangeIndex = 0;
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

        while (allowedRanges && allowedRangeIndex < allowedRanges.length &&
          allowedRanges[allowedRangeIndex].endIndex <= startIndex) {
          allowedRangeIndex++;
        }
        const range = allowedRanges?.[allowedRangeIndex];
        if (allowedRanges && (!range || startIndex < range.startIndex || endIndex > range.endIndex)) {
          if (regex.lastIndex === startIndex) regex.lastIndex++;
          continue;
        }

        rawMatches.push({
          rule,
          startIndex,
          endIndex,
          matchedText,
          ruleIndex,
        });

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

  // @CORE: Deterministically arbitrate overlapping spans using priority, length, then rule order.
  // @TODO: Test and verify priority ties, nested spans, adjacent spans, and Fenwick prefix boundaries.
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

    const starts = Array.from(new Set(matches.map((match) => match.startIndex))).sort((a, b) => a - b);
    const startIndexes = new Map(starts.map((start, index) => [start, index + 1]));
    const fenwick = new Array<number>(starts.length + 1).fill(Number.NEGATIVE_INFINITY);
    const accepted: T[] = [];

    const prefixMaximum = (count: number): number => {
      let maximum = Number.NEGATIVE_INFINITY;
      for (let index = count; index > 0; index -= index & -index) {
        maximum = Math.max(maximum, fenwick[index]);
      }
      return maximum;
    };

    const updateMaximum = (position: number, endIndex: number): void => {
      for (let index = position; index < fenwick.length; index += index & -index) {
        fenwick[index] = Math.max(fenwick[index], endIndex);
      }
    };

    for (const candidate of matches) {
      // Number of indexed starts strictly before candidate.endIndex.
      let low = 0;
      let high = starts.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (starts[mid] < candidate.endIndex) low = mid + 1;
        else high = mid;
      }
      const overlaps = prefixMaximum(low) > candidate.startIndex;

      if (!overlaps) {
        accepted.push(candidate);
        updateMaximum(startIndexes.get(candidate.startIndex)!, candidate.endIndex);
      }
    }

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
