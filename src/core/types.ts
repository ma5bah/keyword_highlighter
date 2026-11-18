import * as vscode from 'vscode';

// @CORE: Data contract defining individual keyword rule configurations
// @TODO: Test and verify validation with missing optional fields, malformed regex strings, and conflicting priorities
export interface KeywordRule {
  id: string;
  text: string;
  enabled: boolean;
  color?: string;
  backgroundColor?: string;
  fontWeight?: string;
  fontStyle?: string;
  borderColor?: string;
  borderRadius?: string;
  wholeLine?: boolean;
  priority: number;
  isRegex?: boolean;
  wholeWord?: boolean;
}

// @CORE: Normalized match representation produced by the matching engine
// @TODO: Test and verify range accuracy across unicode, multi-line offsets, and overlapping boundary cases
export interface KeywordMatch {
  rule: KeywordRule;
  startIndex: number;
  endIndex: number;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  matchedText: string;
}

// @CORE: Top-level extension configuration state contract
// @TODO: Test and verify schema migration, invalid types, and default fallback behaviors
export interface ExtensionConfig {
  enabled: boolean;
  caseSensitive: boolean;
  adaptiveContrast: boolean;
  highlightMode: 'keyword' | 'wholeLine';
  keywords: KeywordRule[];
  markdownPreview: boolean;
  include: string[];
  exclude: string[];
  languages: string[];
  maxFileSizeKB: number;
  commentOnly: boolean;
  gitDiffChangedLinesOnly: boolean;
  overviewRuler: boolean;
}
