import * as vscode from 'vscode';
import { ExtensionConfig, KeywordMatch } from '../core/types';
import { MatchingEngine } from '../core/matchingEngine';
import { ThemeManager } from '../managers/themeManager';

// @CORE: Adapter bridging keyword matching logic with VS Code TextEditor decoration APIs
// @TODO: Test and verify side-by-side Git diff panes, inline diffs, dirty document versions, and editor disposal
export class DecorationAdapter implements vscode.Disposable {
  private config: ExtensionConfig;
  private matchingEngine: MatchingEngine;
  private themeManager: ThemeManager;
  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private matchCache: Map<string, { version: number; length: number; matches: KeywordMatch[] }> = new Map();

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

      // For whole-line highlights, use a translucent tint to avoid obscuring Git diff additions/deletions
      let backgroundColor = rule.backgroundColor || '#DC2626';
      if (isWholeLine) {
        backgroundColor = this.themeManager.toRgbaString(backgroundColor, 0.28);
      }

      const renderOptions: vscode.DecorationRenderOptions = {
        backgroundColor: backgroundColor,
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

    // Key by URI + viewColumn to prevent split diff panes from cancelling each other
    const key = `${editor.document.uri.toString()}#${editor.viewColumn ?? 0}`;
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(key);
    }

    if (immediate) {
      this.decorateEditor(editor);
      this.scheduleAsyncDiffRetries(editor);
    } else {
      const timer = setTimeout(() => {
        this.debounceTimers.delete(key);
        this.decorateEditor(editor);
        this.scheduleAsyncDiffRetries(editor);
      }, 75);
      this.debounceTimers.set(key, timer);
    }
  }

  // @CORE: Schedule asynchronous retries for Git virtual documents whose contents populate after initial opening
  // @TODO: Test and verify git diffs loaded from remote or slow source control providers
  private scheduleAsyncDiffRetries(editor: vscode.TextEditor): void {
    if (!editor || !editor.document || editor.document.uri.scheme !== 'git') {
      return;
    }

    // Git diff original pane often loads content after onDidChangeVisibleTextEditors
    const retries = [100, 300, 800];
    for (const delay of retries) {
      setTimeout(() => {
        for (const visible of vscode.window.visibleTextEditors) {
          if (visible === editor || visible.document.uri.toString() === editor.document.uri.toString()) {
            this.decorateEditor(visible);
          }
        }
      }, delay);
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

    try {
      for (const [ruleId, decType] of this.decorationTypes.entries()) {
        const ranges = ruleRangesMap.get(ruleId) || [];
        editor.setDecorations(decType, ranges);
      }
    } catch {
      // Safely ignore editors closed during decoration
    }
  }

  // @CORE: Clear all active decorations from an editor
  // @TODO: Test and verify cleanup on document close or extension disable
  public clearEditorDecorations(editor: vscode.TextEditor): void {
    try {
      for (const decType of this.decorationTypes.values()) {
        editor.setDecorations(decType, []);
      }
    } catch {
      // Safely ignore already closed editors
    }
  }

  // @CORE: Retrieve cached document matches or scan document text
  // @TODO: Test and verify cache invalidation on text edits and multiple editors viewing same file
  private getOrComputeMatches(document: vscode.TextDocument): KeywordMatch[] {
    const uriKey = document.uri.toString();
    const isGit = document.uri.scheme === 'git';
    const text = document.getText();
    const currentLen = text.length;

    // Do not use stale cache for git virtual documents whose text was loaded asynchronously
    if (!isGit) {
      const cached = this.matchCache.get(uriKey);
      if (cached && cached.version === document.version && cached.length === currentLen) {
        return cached.matches;
      }
    }

    const matches = this.matchingEngine.findMatches(text);

    if (currentLen > 0) {
      this.matchCache.set(uriKey, {
        version: document.version,
        length: currentLen,
        matches,
      });
    }

    return matches;
  }

  // @CORE: Check file eligibility against size limits, languages, and glob patterns
  // @TODO: Test and verify include/exclude glob precedence and binary or synthetic URIs
  private isDocumentSupported(document: vscode.TextDocument): boolean {
    if (!document) {
      return false;
    }

    const scheme = document.uri.scheme;
    // Whitelist common text editing schemes and ignore system/output schemes
    const ignoredSchemes = ['output', 'debug', 'vscode-settings', 'walkThrough'];
    if (ignoredSchemes.includes(scheme)) {
      return false;
    }

    if (this.config.maxFileSizeKB > 0) {
      const approxSizeKB = document.getText().length / 1024;
      if (approxSizeKB > this.config.maxFileSizeKB) {
        return false;
      }
    }

    // Language filter: in Git diffs, languageId can temporarily be 'git' or 'diff'
    if (this.config.languages && this.config.languages.length > 0 && !this.config.languages.includes('*')) {
      const isAllowedLanguage =
        this.config.languages.includes(document.languageId) ||
        (scheme === 'git' && (document.languageId === 'git' || document.languageId === 'diff'));

      if (!isAllowedLanguage) {
        return false;
      }
    }

    const checkPath = document.uri.fsPath || document.uri.path;
    if (checkPath && this.config.exclude && this.config.exclude.length > 0) {
      for (const pattern of this.config.exclude) {
        if (this.matchGlob(checkPath, pattern)) {
          return false;
        }
      }
    }

    if (checkPath && this.config.include && this.config.include.length > 0) {
      let included = false;
      for (const pattern of this.config.include) {
        if (this.matchGlob(checkPath, pattern)) {
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
