import * as vscode from 'vscode';
import { ExtensionConfig, KeywordRule, KeywordMatch } from './types';
import { MatchingEngine } from './matchingEngine';
import { ThemeManager } from './themeManager';

// @CORE: Adapter bridging keyword matching logic with VS Code TextEditor decoration APIs
// @TODO: Test and verify side-by-side Git diff panes, inline diffs, dirty document versions, and editor disposal
export class DecorationAdapter implements vscode.Disposable {
  private config: ExtensionConfig;
  private matchingEngine: MatchingEngine;
  private themeManager: ThemeManager;
  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private matchCache: Map<string, { version: number; matches: KeywordMatch[] }> = new Map();

  constructor(
    config: ExtensionConfig,
    matchingEngine: MatchingEngine,
    themeManager: ThemeManager
  ) {
    this.config = config;
    this.matchingEngine = matchingEngine;
    this.themeManager = themeManager;
    this.recreateDecorationTypes();
  }

  // @CORE: Recreate decoration types when settings or color themes change
  // @TODO: Test and verify old decoration cleanup to prevent memory leaks and ghost highlights
  public recreateDecorationTypes(): void {
    // Dispose previous decoration types
    for (const decType of this.decorationTypes.values()) {
      decType.dispose();
    }
    this.decorationTypes.clear();
    this.matchCache.clear();

    if (!this.config.enabled) {
      return;
    }

    for (const rule of this.config.keywords) {
      if (!rule.enabled) {
        continue;
      }

      const foreground = this.config.adaptiveContrast
        ? this.themeManager.resolveForegroundColor(rule.backgroundColor, rule.color)
        : rule.color && rule.color !== 'auto'
        ? rule.color
        : '#FFFFFF';

      const border = this.themeManager.resolveBorder(rule.borderColor, rule.backgroundColor);
      const isWholeLine = rule.wholeLine || this.config.highlightMode === 'wholeLine';

      const renderOptions: vscode.DecorationRenderOptions = {
        backgroundColor: rule.backgroundColor || '#DC2626',
        color: foreground,
        fontWeight: rule.fontWeight || 'bold',
        fontStyle: rule.fontStyle || 'normal',
        borderRadius: rule.borderRadius || '2px',
        border: border,
        isWholeLine: isWholeLine,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      };

      const decType = vscode.window.createTextEditorDecorationType(renderOptions);
      this.decorationTypes.set(rule.id, decType);
    }
  }

  // @CORE: Update active configuration and trigger complete editor highlight refresh
  // @TODO: Test and verify configuration hot-reloading across open tabs and split panes
  public updateConfig(newConfig: ExtensionConfig): void {
    this.config = newConfig;
    this.matchingEngine.updateRules(this.config.keywords, this.config.caseSensitive);
    this.recreateDecorationTypes();
    this.refreshAllVisibleEditors();
  }

  // @CORE: Update theme manager and refresh contrast calculations
  // @TODO: Test and verify contrast adjustment upon OS light/dark mode switch
  public updateTheme(themeKind: vscode.ColorThemeKind): void {
    this.themeManager.updateTheme(themeKind);
    this.recreateDecorationTypes();
    this.refreshAllVisibleEditors();
  }

  // @CORE: Refresh all visible editors, including side-by-side Git diff panes
  // @TODO: Test and verify both original and modified Git diff text editors receive decorations
  public refreshAllVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.decorateEditor(editor);
    }
  }

  // @CORE: Debounced editor decoration trigger to preserve typing performance
  // @TODO: Test and verify rapid typing bursts, undo/redo keystrokes, and debouncing delay
  public triggerUpdate(editor: vscode.TextEditor, immediate: boolean = false): void {
    if (!editor || !editor.document) {
      return;
    }

    const key = editor.document.uri.toString();
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(key);
    }

    if (immediate) {
      this.decorateEditor(editor);
    } else {
      const timer = setTimeout(() => {
        this.debounceTimers.delete(key);
        this.decorateEditor(editor);
      }, 75);
      this.debounceTimers.set(key, timer);
    }
  }

  // @CORE: Apply decorations to a specific TextEditor instance
  // @TODO: Test and verify read-only documents, large files exceeding maxFileSizeKB, and language filters
  public decorateEditor(editor: vscode.TextEditor): void {
    if (!editor || !editor.document) {
      return;
    }

    if (!this.config.enabled) {
      this.clearEditorDecorations(editor);
      return;
    }

    const doc = editor.document;
    if (!this.isDocumentSupported(doc)) {
      this.clearEditorDecorations(editor);
      return;
    }

    const matches = this.getOrComputeMatches(doc);
    const ruleRangesMap = new Map<string, vscode.Range[]>();

    for (const rule of this.config.keywords) {
      if (rule.enabled) {
        ruleRangesMap.set(rule.id, []);
      }
    }

    for (const match of matches) {
      const ranges = ruleRangesMap.get(match.rule.id);
      if (ranges) {
        const range = new vscode.Range(
          match.startLine,
          match.startChar,
          match.endLine,
          match.endChar
        );
        ranges.push(range);
      }
    }

    // Apply ranges for each decoration type
    for (const [ruleId, decType] of this.decorationTypes.entries()) {
      const ranges = ruleRangesMap.get(ruleId) || [];
      editor.setDecorations(decType, ranges);
    }
  }

  // @CORE: Clear all active decorations from an editor
  // @TODO: Test and verify cleanup on document close or extension disable
  public clearEditorDecorations(editor: vscode.TextEditor): void {
    for (const decType of this.decorationTypes.values()) {
      editor.setDecorations(decType, []);
    }
  }

  // @CORE: Retrieve cached document matches or scan document text
  // @TODO: Test and verify cache invalidation on text edits and multiple editors viewing same file
  private getOrComputeMatches(document: vscode.TextDocument): KeywordMatch[] {
    const uriKey = document.uri.toString();
    const version = document.version;
    const cached = this.matchCache.get(uriKey);

    if (cached && cached.version === version) {
      return cached.matches;
    }

    const text = document.getText();
    const matches = this.matchingEngine.findMatches(text);
    this.matchCache.set(uriKey, { version, matches });
    return matches;
  }

  // @CORE: Check file eligibility against size limits, languages, and glob patterns
  // @TODO: Test and verify include/exclude glob precedence and binary or synthetic URIs
  private isDocumentSupported(document: vscode.TextDocument): boolean {
    // 1. Check file size
    if (this.config.maxFileSizeKB > 0) {
      // Rough estimation: document character count in KB
      const approxSizeKB = document.getText().length / 1024;
      if (approxSizeKB > this.config.maxFileSizeKB) {
        return false;
      }
    }

    // 2. Check language filter
    if (this.config.languages && this.config.languages.length > 0) {
      if (!this.config.languages.includes('*') && !this.config.languages.includes(document.languageId)) {
        return false;
      }
    }

    // 3. Check exclude / include globs if applicable
    const filePath = document.uri.fsPath;
    if (filePath && this.config.exclude && this.config.exclude.length > 0) {
      for (const pattern of this.config.exclude) {
        if (this.matchGlob(filePath, pattern)) {
          return false;
        }
      }
    }

    if (filePath && this.config.include && this.config.include.length > 0) {
      let included = false;
      for (const pattern of this.config.include) {
        if (this.matchGlob(filePath, pattern)) {
          included = true;
          break;
        }
      }
      if (!included) {
        return false;
      }
    }

    return true;
  }

  // Simple glob matching utility
  private matchGlob(str: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/(?<!\.)\*/g, '[^/]*');
    try {
      return new RegExp(regexPattern).test(str);
    } catch {
      return false;
    }
  }

  public dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    for (const decType of this.decorationTypes.values()) {
      decType.dispose();
    }
    this.decorationTypes.clear();
    this.matchCache.clear();
  }
}
