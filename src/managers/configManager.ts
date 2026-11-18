import * as vscode from 'vscode';
import { ExtensionConfig, KeywordRule } from '../core/types';

const DEFAULT_KEYWORDS: KeywordRule[] = [
  {
    id: 'default-todo',
    text: '@TODO:',
    enabled: true,
    backgroundColor: '#DC2626',
    color: 'auto',
    fontWeight: 'bold',
    wholeLine: false,
    priority: 10,
  },
  {
    id: 'default-core',
    text: '@CORE:',
    enabled: true,
    backgroundColor: '#2563EB',
    color: 'auto',
    fontWeight: 'bold',
    wholeLine: true,
    priority: 10,
  },
];

// @CORE: Configuration manager maintaining validated, normalized extension settings
// @TODO: Test and verify user/workspace settings precedence, empty rule lists, and invalid type coercion
export class ConfigManager implements vscode.Disposable {
  private config: ExtensionConfig;
  private keywordWrite: Promise<void> = Promise.resolve();
  private disposables: vscode.Disposable[] = [];
  private onDidChangeEmitter = new vscode.EventEmitter<ExtensionConfig>();

  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor() {
    this.config = this.loadEffectiveConfig();

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('keywordHighlighter')) {
          this.config = this.loadEffectiveConfig();
          this.onDidChangeEmitter.fire(this.config);
        }
      })
    );
  }

  // @CORE: Read, normalize, and validate VS Code configuration settings
  // @TODO: Test and verify malformed JSON in settings, negative priorities, and oversized file thresholds
  public loadEffectiveConfig(): ExtensionConfig {
    const wsConfig = vscode.workspace.getConfiguration('keywordHighlighter');

    const enabled = wsConfig.get<boolean>('enabled', true);
    const caseSensitive = wsConfig.get<boolean>('caseSensitive', true);
    const adaptiveContrast = wsConfig.get<boolean>('adaptiveContrast', true);
    const highlightMode = wsConfig.get<'keyword' | 'wholeLine'>('highlightMode', 'keyword');
    const markdownPreview = wsConfig.get<boolean>('markdownPreview', true);
    const include = wsConfig.get<string[]>('include', []);
    const exclude = wsConfig.get<string[]>('exclude', []);
    const languages = wsConfig.get<string[]>('languages', ['*']);
    const maxFileSizeKB = wsConfig.get<number>('maxFileSizeKB', 2048);
    const commentOnly = wsConfig.get<boolean>('commentOnly', false);
    const gitDiffChangedLinesOnly = wsConfig.get<boolean>('gitDiffChangedLinesOnly', false);
    const overviewRuler = wsConfig.get<boolean>('overviewRuler', true);

    const rawKeywords = wsConfig.get<any[]>('keywords', []);
    const keywords = this.normalizeKeywords(rawKeywords);

    return {
      enabled,
      caseSensitive,
      adaptiveContrast,
      highlightMode,
      keywords,
      markdownPreview,
      include,
      exclude,
      languages,
      maxFileSizeKB,
      commentOnly,
      gitDiffChangedLinesOnly,
      overviewRuler,
    };
  }

  // @CORE: Normalize and assign deterministic IDs to configured keyword rules
  // @TODO: Test and verify default fallback when user rules array is empty or corrupted
  private normalizeKeywords(raw: any[]): KeywordRule[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      return [...DEFAULT_KEYWORDS];
    }

    const normalized: KeywordRule[] = [];
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (!item || typeof item.text !== 'string' || item.text.trim().length === 0) {
        continue;
      }

      normalized.push({
        id: `rule-${i}-${item.text}`,
        text: item.text,
        enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
        color: typeof item.color === 'string' ? item.color : 'auto',
        backgroundColor: typeof item.backgroundColor === 'string' ? item.backgroundColor : '#DC2626',
        fontWeight: item.fontWeight === 'normal' || item.fontWeight === 'bold' ? item.fontWeight : 'bold',
        fontStyle: item.fontStyle === 'italic' || item.fontStyle === 'normal' ? item.fontStyle : 'normal',
        borderColor: typeof item.borderColor === 'string' ? item.borderColor : undefined,
        borderRadius: typeof item.borderRadius === 'string' ? item.borderRadius : '2px',
        wholeLine: typeof item.wholeLine === 'boolean' ? item.wholeLine : false,
        priority: typeof item.priority === 'number' ? item.priority : 10,
        isRegex: typeof item.isRegex === 'boolean' ? item.isRegex : false,
        wholeWord: typeof item.wholeWord === 'boolean' ? item.wholeWord : false,
      });
    }

    return normalized.length > 0 ? normalized : [...DEFAULT_KEYWORDS];
  }

  public getConfig(): ExtensionConfig {
    return this.config;
  }

  // @CORE: Update enabled state in the effective user or workspace settings scope.
  // @TODO: Test setting precedence and recovery from rejected configuration writes.
  public async setEnabled(enabled: boolean): Promise<void> {
    const wsConfig = vscode.workspace.getConfiguration('keywordHighlighter');
    const inspected = wsConfig.inspect<boolean>('enabled');
    const target = inspected?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await wsConfig.update('enabled', enabled, target);
  }

  // @CORE: Persist selected text as a literal keyword without replacing existing rules
  // @TODO: Test and verify duplicate detection and preserving explicit empty/default rule configurations
  public addKeyword(text: string): Promise<boolean> {
    const operation = this.keywordWrite.then(async () => {
      const wsConfig = vscode.workspace.getConfiguration('keywordHighlighter');
      const existing = wsConfig.get<any[]>('keywords', []);
      const rules = Array.isArray(existing) && existing.length
        ? [...existing]
        : this.config.keywords.map(({ id: _id, ...rule }) => ({ ...rule }));
      if (rules.some((rule) => rule && rule.text === text && rule.isRegex !== true)) {
        return false;
      }
      rules.push({ text, enabled: true, isRegex: false, priority: 10 });
      const inspected = wsConfig.inspect('keywords');
      const target = inspected?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      await wsConfig.update('keywords', rules, target);
      return true;
    });
    this.keywordWrite = operation.then(() => undefined, () => undefined);
    return operation;
  }

  public dispose(): void {
    this.onDidChangeEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
