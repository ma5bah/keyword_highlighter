import * as vscode from 'vscode';
import { ConfigManager } from './managers/configManager';
import { MatchingEngine } from './core/matchingEngine';
import { ThemeManager } from './managers/themeManager';
import { DecorationAdapter } from './adapters/decorationAdapter';
import { WorkspaceMatches } from './adapters/workspaceMatches';
import { keywordHighlighterMarkdownPlugin } from './adapters/markdownPlugin';

let outputChannel: vscode.OutputChannel | undefined;

// @CORE: Coordinate extension services and expose the official VS Code Markdown extension API.
// @TODO: Test and verify startup, Markdown preview activation, and cleanup after repeated enable/configuration changes.
export function activate(context: vscode.ExtensionContext): { extendMarkdownIt: (md: any) => any } {
  outputChannel = vscode.window.createOutputChannel('Keyword Highlighter');
  const configManager = new ConfigManager();
  const themeManager = new ThemeManager();
  const initialConfig = configManager.getConfig();
  const matchingEngine = new MatchingEngine(initialConfig.keywords, initialConfig.caseSensitive);
  const decorationAdapter = new DecorationAdapter(initialConfig, matchingEngine, themeManager);
  const workspaceMatches = new WorkspaceMatches(decorationAdapter);
  let enabledWrite: Promise<void> = Promise.resolve();

  const refreshMarkdown = () => {
    void vscode.commands.executeCommand('markdown.preview.refresh').then(undefined, (error: unknown) => {
      outputChannel?.appendLine(`Markdown preview refresh unavailable: ${String(error)}`);
    });
  };
  const updateEnabled = (desired?: boolean) => {
    const write = enabledWrite.then(async () => {
      const current = configManager.loadEffectiveConfig().enabled;
      const enabled = desired ?? !current;
      await configManager.setEnabled(enabled);
      const effective = configManager.loadEffectiveConfig().enabled;
      vscode.window.showInformationMessage(`Keyword Highlighter is ${effective ? 'enabled' : 'disabled'}.`);
      return effective;
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Could not update Keyword Highlighter: ${message}`);
      return configManager.getConfig().enabled;
    });
    enabledWrite = write.then(() => undefined);
    return write;
  };

  // @CORE: Keep editor, workspace, and preview behavior synchronized with live settings.
  // @TODO: Test and verify configuration/theme changes while editors and previews remain open.
  context.subscriptions.push(
    configManager.onDidChange((newConfig) => {
      decorationAdapter.updateConfig(newConfig);
      workspaceMatches.refresh();
      refreshMarkdown();
    }),
    vscode.window.onDidChangeActiveColorTheme((event) => {
      decorationAdapter.updateTheme(event.kind);
      refreshMarkdown();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) decorationAdapter.triggerUpdate(editor, true);
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === document.uri.toString()) decorationAdapter.triggerUpdate(editor, true);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === event.document.uri.toString()) decorationAdapter.triggerUpdate(editor);
      }
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) decorationAdapter.refreshAllVisibleEditors();
    })
  );

  // @CORE: Provide truthful enable controls, match navigation, and workspace match refresh commands.
  // @TODO: Test and verify scoped settings, adjacent/wrapped navigation, invalid selections, and command failures.
  const commands: vscode.Disposable[] = [
    vscode.commands.registerCommand('keywordHighlighter.enable', () => updateEnabled(true)),
    vscode.commands.registerCommand('keywordHighlighter.disable', () => updateEnabled(false)),
    vscode.commands.registerCommand('keywordHighlighter.toggle', () => updateEnabled()),
    vscode.commands.registerCommand('keywordHighlighter.refresh', () => {
      decorationAdapter.recreateDecorationTypes();
      decorationAdapter.refreshAllVisibleEditors();
      workspaceMatches.refresh();
      refreshMarkdown();
    }),
    vscode.commands.registerCommand('keywordHighlighter.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'keywordHighlighter')),
    vscode.commands.registerCommand('keywordHighlighter.nextMatch', () => navigateMatch(decorationAdapter, 1)),
    vscode.commands.registerCommand('keywordHighlighter.previousMatch', () => navigateMatch(decorationAdapter, -1)),
    vscode.commands.registerCommand('keywordHighlighter.addSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      const text = editor?.selection && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
      if (!text.trim() || /[\r\n]/.test(text)) {
        vscode.window.showWarningMessage('Select a non-empty, single-line keyword first.');
        return;
      }
      try {
        const added = await configManager.addKeyword(text);
        vscode.window.showInformationMessage(added ? `Added keyword: ${text}` : `A literal keyword rule already exists: ${text}`);
      } catch (error) {
        vscode.window.showErrorMessage(`Could not add keyword: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    vscode.commands.registerCommand('keywordHighlighter.refreshWorkspaceMatches', () => workspaceMatches.refresh()),
  ];
  context.subscriptions.push(...commands);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.command = 'keywordHighlighter.toggle';
  const updateStatus = () => {
    const enabled = configManager.getConfig().enabled;
    status.text = `$(symbol-keyword) Keywords ${enabled ? 'On' : 'Off'}`;
    status.tooltip = `Click to ${enabled ? 'disable' : 'enable'} Keyword Highlighter`;
    status.show();
  };
  updateStatus();
  context.subscriptions.push(status, configManager.onDidChange(updateStatus));

  decorationAdapter.refreshAllVisibleEditors();
  workspaceMatches.refresh();
  context.subscriptions.push(configManager, decorationAdapter, workspaceMatches, outputChannel);
  outputChannel.appendLine('Keyword Highlighter activated.');

  return {
    extendMarkdownIt: (md: any) => keywordHighlighterMarkdownPlugin(md, () => ({
      config: configManager.getConfig(),
      engine: matchingEngine,
      theme: themeManager,
    })),
  };
}

// @CORE: Move to the next or previous match relative to the current selection, wrapping at document bounds.
// @TODO: Test and verify consecutive matches, selections spanning matches, and cursor positions outside all matches.
function navigateMatch(adapter: DecorationAdapter, direction: 1 | -1): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const matches = adapter.getEditorMatches(editor).slice().sort((a, b) => a.startIndex - b.startIndex);
  if (!matches.length) {
    vscode.window.showInformationMessage('No keyword matches in this document.');
    return;
  }
  const selection = editor.selection;
  const start = editor.document.offsetAt(selection.start);
  const end = editor.document.offsetAt(selection.end);
  const current = matches.findIndex((match) => match.startIndex === start && match.endIndex === end);
  let target: number;
  if (direction > 0) {
    target = current >= 0
      ? (current + 1) % matches.length
      : matches.findIndex((match) => match.startIndex >= end);
    if (target < 0) target = 0;
  } else {
    target = current >= 0
      ? (current - 1 + matches.length) % matches.length
      : -1;
    if (target < 0) {
      for (let index = matches.length - 1; index >= 0; index--) {
        if (matches[index].endIndex <= start) { target = index; break; }
      }
      if (target < 0) target = matches.length - 1;
    }
  }
  const match = matches[target];
  const range = new vscode.Range(match.startLine, match.startChar, match.endLine, match.endChar);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

// @CORE: Extension deactivation hook; all owned resources are disposed through context subscriptions.
// @TODO: Test and verify disposal of status, settings listeners, adapters, and commands on deactivation.
export function deactivate(): void {
  outputChannel?.appendLine('Keyword Highlighter deactivated.');
}
