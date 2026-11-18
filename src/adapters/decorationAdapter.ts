import * as vscode from 'vscode';
import { ExtensionConfig, KeywordMatch } from '../core/types';
import { MatchingEngine } from '../core/matchingEngine';
import { changedLineNumbers } from '../core/lineDiff';
import { findCommentRanges } from '../core/commentRanges';
import { ThemeManager } from '../managers/themeManager';

type MatchCacheEntry = { version: number; matches: KeywordMatch[] };
type DiffCacheEntry = {
  original: vscode.TextDocument;
  originalVersion: number;
  modifiedVersion: number;
  changedLines: Set<number>;
};
type RetryEntry = { timers: Set<ReturnType<typeof setTimeout>>; original: vscode.Uri; modified: vscode.Uri };

// @CORE: Adapter bridging keyword matches with editor decorations, filters, and Git diff visibility.
// @TODO: Test and verify diff panes, delayed counterpart loading, edits, navigation, and cleanup.
export class DecorationAdapter implements vscode.Disposable {
  private config: ExtensionConfig;
  private matchingEngine: MatchingEngine;
  private themeManager: ThemeManager;
  private decorationTypes = new Map<string, vscode.TextEditorDecorationType>();
  private debounceTimers = new Map<vscode.TextEditor, ReturnType<typeof setTimeout>>();
  private retryTimers = new Map<string, RetryEntry>();
  private matchCache = new WeakMap<vscode.TextDocument, MatchCacheEntry>();
  private diffCache = new WeakMap<vscode.TextDocument, DiffCacheEntry>();
  private disposables: vscode.Disposable[] = [];

  constructor(config: ExtensionConfig, matchingEngine: MatchingEngine, themeManager: ThemeManager) {
    this.config = config;
    this.matchingEngine = matchingEngine;
    this.themeManager = themeManager;
    this.recreateDecorationTypes();
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(() => this.refreshAllVisibleEditors()),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        this.cleanupRetries();
        const visible = new Set(editors);
        for (const [editor, timer] of this.debounceTimers) {
          if (!visible.has(editor)) {
            clearTimeout(timer);
            this.debounceTimers.delete(editor);
          }
        }
        for (const editor of editors) this.triggerUpdate(editor, true);
      }),
      vscode.workspace.onDidOpenTextDocument((document) => this.refreshDiffModifiedForUri(document.uri)),
      vscode.workspace.onDidChangeTextDocument((event) => this.refreshDiffModifiedForUri(event.document.uri)),
      vscode.workspace.onDidCloseTextDocument((document) => this.refreshDiffModifiedForUri(document.uri))
    );
  }

  // @CORE: Recreate decoration types when settings or color themes change.
  // @TODO: Test and verify old decoration cleanup and overview ruler toggling.
  public recreateDecorationTypes(): void {
    for (const type of this.decorationTypes.values()) type.dispose();
    this.decorationTypes.clear();
    this.matchCache = new WeakMap();
    this.diffCache = new WeakMap();
    if (!this.config.enabled) return;

    for (const rule of this.config.keywords) {
      if (!rule.enabled) continue;
      const foreground = this.config.adaptiveContrast
        ? this.themeManager.resolveForegroundColor(rule.backgroundColor, rule.color)
        : rule.color && rule.color !== 'auto' ? rule.color : '#FFFFFF';
      const border = this.themeManager.resolveBorder(rule.borderColor, rule.backgroundColor);
      const isWholeLine = rule.wholeLine || this.config.highlightMode === 'wholeLine';
      let backgroundColor = rule.backgroundColor || '#DC2626';
      if (isWholeLine) backgroundColor = this.themeManager.toRgbaString(backgroundColor, 0.28);
      const renderOptions: vscode.DecorationRenderOptions = {
        backgroundColor, color: foreground, fontWeight: rule.fontWeight || 'bold',
        fontStyle: rule.fontStyle || 'normal', borderRadius: rule.borderRadius || '2px',
        border, isWholeLine, rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      };
      if (this.config.overviewRuler) {
        renderOptions.overviewRulerColor = rule.backgroundColor || '#DC2626';
        renderOptions.overviewRulerLane = vscode.OverviewRulerLane.Right;
      }
      this.decorationTypes.set(rule.id, vscode.window.createTextEditorDecorationType(renderOptions));
    }
  }

  // @CORE: Apply active settings and refresh all visible editors.
  // @TODO: Test and verify live filter, cache, and diff setting updates.
  public updateConfig(newConfig: ExtensionConfig): void {
    this.config = newConfig;
    this.matchingEngine.updateRules(this.config.keywords, this.config.caseSensitive);
    this.recreateDecorationTypes();
    this.refreshAllVisibleEditors();
  }

  // @CORE: Refresh colors and highlights after a theme change.
  // @TODO: Test and verify contrast across light, dark, and high-contrast themes.
  public updateTheme(themeKind: vscode.ColorThemeKind): void {
    this.themeManager.updateTheme(themeKind);
    this.recreateDecorationTypes();
    this.refreshAllVisibleEditors();
  }

  // @CORE: Refresh every visible editor, including both panes of an active diff.
  // @TODO: Test and verify simultaneous regular and split-diff editors.
  public refreshAllVisibleEditors(): void {
    this.cleanupRetries();
    for (const editor of vscode.window.visibleTextEditors) this.decorateEditor(editor);
  }

  // @CORE: Debounce decorations while retaining immediate navigation updates.
  // @TODO: Test and verify rapid edits and editor disappearance during a debounce.
  public triggerUpdate(editor: vscode.TextEditor, immediate = false): void {
    if (!editor?.document) return;
    const oldTimer = this.debounceTimers.get(editor);
    if (oldTimer) clearTimeout(oldTimer);
    if (immediate) {
      this.debounceTimers.delete(editor);
      this.decorateEditor(editor);
    } else {
      this.debounceTimers.set(editor, setTimeout(() => {
        this.debounceTimers.delete(editor);
        if (vscode.window.visibleTextEditors.includes(editor)) {
          this.decorateEditor(editor);
        }
      }, 75));
    }
  }

  // @CORE: Return document matches after shared eligibility and optional comment-only filtering.
  // @TODO: Test and verify eligibility, comment language coverage, and non-comment exclusion.
  public getDocumentMatches(document: vscode.TextDocument): KeywordMatch[] {
    if (!this.config.enabled) return [];
    let cached = this.matchCache.get(document);
    if (!cached || cached.version !== document.version) {
      const text = document.getText();
      if (!this.isDocumentSupported(document, text.length)) {
        cached = { version: document.version, matches: [] };
        this.matchCache.set(document, cached);
        return cached.matches;
      }
      const commentRanges = this.config.commentOnly ? findCommentRanges(text, document.languageId) : undefined;
      cached = {
        version: document.version,
        matches: this.matchingEngine.findMatches(text, commentRanges),
      };
      this.matchCache.set(document, cached);
    }
    return cached.matches;
  }

  // @CORE: Return visible keyword matches for navigation, limiting Git diffs to changed modified-side lines.
  // @TODO: Test and verify modified-pane URI matching, inline views, edits, and counterpart loading.
  public getEditorMatches(editor: vscode.TextEditor): KeywordMatch[] {
    if (!editor?.document) return [];
    const documentMatches = this.getDocumentMatches(editor.document);
    if (documentMatches.length === 0) return [];
    if (!this.config.gitDiffChangedLinesOnly) return documentMatches;
    const context = this.findDiffContext(editor);
    if (!context) return documentMatches;
    if (editor.document.uri.toString() !== context.modified.toString()) return [];
    const original = this.findOpenDocument(context.original);
    if (!original) {
      this.schedulePairRetries(context);
      return [];
    }
    this.clearRetry(context.key);
    const changedLines = this.getChangedLines(original, editor.document);
    return documentMatches.filter((match) => {
      const lastLine = match.endLine > match.startLine && match.endChar === 0 ? match.endLine - 1 : match.endLine;
      for (let line = match.startLine; line <= lastLine; line++) if (!changedLines.has(line)) return false;
      return true;
    });
  }

  // @CORE: Render only navigation-visible matches while preserving normal editor behavior.
  // @TODO: Test and verify decorations update when counterpart content becomes available.
  public decorateEditor(editor: vscode.TextEditor): void {
    if (!editor?.document) return;
    if (!this.config.enabled) {
      this.clearEditorDecorations(editor);
      return;
    }
    const ruleRanges = new Map<string, vscode.Range[]>();
    for (const rule of this.config.keywords) if (rule.enabled) ruleRanges.set(rule.id, []);
    for (const match of this.getEditorMatches(editor)) {
      const ranges = ruleRanges.get(match.rule.id);
      if (ranges) ranges.push(new vscode.Range(match.startLine, match.startChar, match.endLine, match.endChar));
    }
    try {
      for (const [id, type] of this.decorationTypes) editor.setDecorations(type, ruleRanges.get(id) || []);
    } catch { /* The editor may close while decorations are being applied. */ }
  }

  // @CORE: Remove all adapter decorations from one editor.
  // @TODO: Test and verify cleanup on close and extension disable.
  public clearEditorDecorations(editor: vscode.TextEditor): void {
    try { for (const type of this.decorationTypes.values()) editor.setDecorations(type, []); }
    catch { /* The editor may already be closed. */ }
  }

  // @CORE: Resolve a visible Git diff tab using stable tab group inputs, including staged git-to-git pairs.
  // @TODO: Test and verify tab switches and provider URI combinations.
  private findDiffContext(editor: vscode.TextEditor): { original: vscode.Uri; modified: vscode.Uri; key: string } | undefined {
    const target = editor.document.uri.toString();
    for (const group of vscode.window.tabGroups.all) {
      if (group.viewColumn !== editor.viewColumn) continue;
      const tab = group.activeTab;
      if (!tab || !(tab.input instanceof vscode.TabInputTextDiff)) continue;
      const { original, modified } = tab.input;
      if (original.scheme !== 'git' && modified.scheme !== 'git') continue;
      if (original.toString() === target || modified.toString() === target) {
        return { original, modified, key: `${original.toString()}=>${modified.toString()}` };
      }
    }
    return undefined;
  }

  private findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
  }

  private getChangedLines(original: vscode.TextDocument, modified: vscode.TextDocument): Set<number> {
    const cached = this.diffCache.get(modified);
    if (cached && cached.original === original && cached.originalVersion === original.version &&
        cached.modifiedVersion === modified.version) return cached.changedLines;
    const changedLines = changedLineNumbers(original.getText(), modified.getText());
    this.diffCache.set(modified, { original, originalVersion: original.version, modifiedVersion: modified.version, changedLines });
    return changedLines;
  }

  // @CORE: Retry finite delayed diff document loading and deduplicate work by tab pair.
  // @TODO: Test and verify retries stop after readiness, tab closure, or adapter disposal.
  private schedulePairRetries(context: { original: vscode.Uri; modified: vscode.Uri; key: string }): void {
    if (this.retryTimers.has(context.key)) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    this.retryTimers.set(context.key, { timers, original: context.original, modified: context.modified });
    for (const delay of [100, 300, 800, 1500]) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!this.hasDiffPair(context.original, context.modified)) {
          this.clearRetry(context.key);
          return;
        }
        if (!this.findOpenDocument(context.original)) {
          if (timers.size === 0) this.retryTimers.delete(context.key);
          return;
        }
        this.clearRetry(context.key);
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document.uri.toString() === context.modified.toString()) this.decorateEditor(editor);
        }
      }, delay);
      timers.add(timer);
    }
  }

  private hasDiffPair(original: vscode.Uri, modified: vscode.Uri): boolean {
    return vscode.window.tabGroups.all.some((group) => {
      const input = group.activeTab?.input;
      return input instanceof vscode.TabInputTextDiff &&
        input.original.toString() === original.toString() && input.modified.toString() === modified.toString() &&
        vscode.window.visibleTextEditors.some((editor) => editor.viewColumn === group.viewColumn &&
          editor.document.uri.toString() === modified.toString());
    });
  }

  private cleanupRetries(): void {
    for (const [key, entry] of this.retryTimers) {
      if (this.hasDiffPair(entry.original, entry.modified)) continue;
      this.clearRetry(key);
    }
  }

  private clearRetry(key: string): void {
    const entry = this.retryTimers.get(key);
    if (!entry) return;
    for (const timer of entry.timers) clearTimeout(timer);
    this.retryTimers.delete(key);
  }

  private refreshDiffModifiedForUri(uri: vscode.Uri): void {
    const uriString = uri.toString();
    for (const group of vscode.window.tabGroups.all) {
      const input = group.activeTab?.input;
      if (!(input instanceof vscode.TabInputTextDiff) ||
          (input.original.scheme !== 'git' && input.modified.scheme !== 'git') ||
          input.original.toString() !== uriString) continue;
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.viewColumn === group.viewColumn && editor.document.uri.toString() === input.modified.toString()) {
          this.triggerUpdate(editor, true);
        }
      }
    }
  }

  // @CORE: Apply document size, language, include, and exclude constraints consistently.
  // @TODO: Test and verify glob precedence and synthetic document URI handling.
  private isDocumentSupported(document: vscode.TextDocument, textLength: number): boolean {
    if (!document || ['output', 'debug', 'vscode-settings', 'walkThrough'].includes(document.uri.scheme)) return false;
    if (this.config.maxFileSizeKB > 0 && textLength / 1024 > this.config.maxFileSizeKB) return false;
    if (this.config.languages?.length && !this.config.languages.includes('*') &&
        !this.config.languages.includes(document.languageId) &&
        !(document.uri.scheme === 'git' && ['git', 'diff'].includes(document.languageId))) return false;
    const path = document.uri.fsPath || document.uri.path;
    if (path && this.config.exclude?.some((pattern) => this.matchGlob(path, pattern))) return false;
    if (path && this.config.include?.length && !this.config.include.some((pattern) => this.matchGlob(path, pattern))) return false;
    return true;
  }

  private matchGlob(value: string, pattern: string): boolean {
    const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*');
    try { return new RegExp(regexPattern).test(value); } catch { return false; }
  }

  public dispose(): void {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    for (const key of this.retryTimers.keys()) this.clearRetry(key);
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
    for (const type of this.decorationTypes.values()) type.dispose();
    this.decorationTypes.clear();
    this.matchCache = new WeakMap();
    this.diffCache = new WeakMap();
  }
}
