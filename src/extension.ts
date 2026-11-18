import * as vscode from 'vscode';
import { ConfigManager } from './managers/configManager';
import { MatchingEngine } from './core/matchingEngine';
import { ThemeManager } from './managers/themeManager';
import { DecorationAdapter } from './adapters/decorationAdapter';

let outputChannel: vscode.OutputChannel | undefined;

// @CORE: Extension activation entry point coordinating configuration, matching, and UI adapters
// @TODO: Test and verify clean startup across VS Code desktop and web, and recovery from activation errors
export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Keyword Highlighter');
  outputChannel.appendLine('Keyword Highlighter activating...');

  const configManager = new ConfigManager();
  const themeManager = new ThemeManager();
  const initialConfig = configManager.getConfig();

  const matchingEngine = new MatchingEngine(
    initialConfig.keywords,
    initialConfig.caseSensitive
  );

  const decorationAdapter = new DecorationAdapter(
    initialConfig,
    matchingEngine,
    themeManager
  );

  context.subscriptions.push(
    configManager.onDidChange((newConfig) => {
      decorationAdapter.updateConfig(newConfig);
      outputChannel?.appendLine('Configuration reloaded.');
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme((e) => {
      decorationAdapter.updateTheme(e.kind);
      outputChannel?.appendLine(`Color theme changed to kind: ${e.kind}`);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        decorationAdapter.triggerUpdate(editor, true);
      }
    }),

    // @CORE: Listen to visible text editors to support side-by-side and inline Git diff panes
    // @TODO: Test and verify diff editor split-screen views and Git staging panes
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        decorationAdapter.triggerUpdate(editor, true);
      }
    }),

    // @CORE: Detect newly opened virtual documents (such as Git HEAD revisions in diff panes)
    // @TODO: Test and verify onDidOpenTextDocument timing for git: and diff: schemes
    vscode.workspace.onDidOpenTextDocument((doc) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === doc.uri.toString()) {
          decorationAdapter.triggerUpdate(editor, true);
        }
      }
    }),

    vscode.workspace.onDidChangeTextDocument((event) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === event.document.uri.toString()) {
          decorationAdapter.triggerUpdate(editor, false);
        }
      }
    }),

    // @CORE: Re-verify highlights when diff views scroll, collapse, or switch between inline and side-by-side
    // @TODO: Test and verify inline diff gutter expansion and fast scrolling
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      decorationAdapter.triggerUpdate(event.textEditor, false);
    }),

    // @CORE: Refresh when window regains focus after external Git operations (e.g. checkout, rebase)
    // @TODO: Test and verify focus recovery after terminal git commands
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        decorationAdapter.refreshAllVisibleEditors();
      }
    })
  );

  // @CORE: Register extension commands for enabling, disabling, toggling, and refreshing highlights
  // @TODO: Test and verify command palette invocations, keybindings, and state persistence
  context.subscriptions.push(
    vscode.commands.registerCommand('keywordHighlighter.enable', async () => {
      await configManager.setEnabled(true);
      vscode.window.showInformationMessage('Keyword Highlighter is now enabled.');
      decorationAdapter.refreshAllVisibleEditors();
    }),

    vscode.commands.registerCommand('keywordHighlighter.disable', async () => {
      await configManager.setEnabled(false);
      vscode.window.showInformationMessage('Keyword Highlighter is now disabled.');
      decorationAdapter.refreshAllVisibleEditors();
    }),

    vscode.commands.registerCommand('keywordHighlighter.toggle', async () => {
      const currentState = configManager.getConfig().enabled;
      await configManager.setEnabled(!currentState);
      vscode.window.showInformationMessage(
        `Keyword Highlighter is now ${!currentState ? 'enabled' : 'disabled'}.`
      );
      decorationAdapter.refreshAllVisibleEditors();
    }),

    vscode.commands.registerCommand('keywordHighlighter.refresh', () => {
      decorationAdapter.recreateDecorationTypes();
      decorationAdapter.refreshAllVisibleEditors();
      outputChannel?.appendLine('Highlights manually refreshed.');
    }),

    vscode.commands.registerCommand('keywordHighlighter.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'keywordHighlighter');
    })
  );

  decorationAdapter.refreshAllVisibleEditors();

  context.subscriptions.push(configManager, decorationAdapter, outputChannel);
  outputChannel.appendLine('Keyword Highlighter activated successfully.');
}

// @CORE: Extension deactivation cleanup
// @TODO: Test and verify that all registered decorations and timers are disposed without leaks
export function deactivate(): void {
  outputChannel?.appendLine('Keyword Highlighter deactivated.');
}
