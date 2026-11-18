import * as vscode from 'vscode';
import { KeywordMatch } from '../core/types';
import { DecorationAdapter } from './decorationAdapter';

type MatchRow = { uri: vscode.Uri; match: KeywordMatch };
type TreeNode = { label: string; uri?: vscode.Uri; range?: vscode.Range; children?: TreeNode[]; description?: string };
type ActiveScan = { token: vscode.CancellationTokenSource; version: number };

// @CORE: Lazily scan workspace documents and expose keyword matches as navigable file groups
// @TODO: Test and verify cancellation, stale scans, working copies, bounds, and navigation recovery
export class WorkspaceMatches implements vscode.Disposable {
  private readonly tree: vscode.TreeView<TreeNode>;
  private readonly provider: vscode.TreeDataProvider<TreeNode>;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly maxFiles = 500;
  private readonly maxMatches = 5000;
  private roots: TreeNode[] = [];
  private activeScan?: ActiveScan;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private version = 0;
  private visible = false;
  private disposed = false;
  private hasScanned = false;
  private status = 'Open the view to find workspace matches';
  private readonly changed = new vscode.EventEmitter<TreeNode | undefined>();

  constructor(private readonly adapter: DecorationAdapter) {
    this.provider = {
      onDidChangeTreeData: this.changed.event,
      getTreeItem: node => {
        const item = new vscode.TreeItem(node.label, node.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        item.description = node.description;
        if (node.uri && node.range) item.command = { command: 'keywordHighlighter.matches.open', title: 'Open Match', arguments: [node.uri, node.range] };
        return item;
      },
      getChildren: node => node ? node.children || [] : this.roots.length ? this.roots : [{ label: this.status }],
    };
    this.tree = vscode.window.createTreeView('keywordHighlighter.matches', { treeDataProvider: this.provider });
    this.visible = this.tree.visible;
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.disposables.push(
      this.tree, this.changed, this.watcher,
      vscode.commands.registerCommand('keywordHighlighter.matches.open', (uri: vscode.Uri, range: vscode.Range) => this.open(uri, range)),
      this.tree.onDidChangeVisibility(e => {
        this.visible = e.visible;
        if (e.visible) { if (!this.hasScanned) void this.scan(); }
        else this.cancelScan();
      }),
      vscode.workspace.onDidChangeTextDocument(e => { if (this.inWorkspace(e.document.uri)) this.scheduleRefresh(); }),
      vscode.workspace.onDidSaveTextDocument(document => { if (this.inWorkspace(document.uri)) this.scheduleRefresh(); }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()),
      this.watcher.onDidCreate(uri => { if (this.inWorkspace(uri)) this.scheduleRefresh(); }),
      this.watcher.onDidDelete(uri => { if (this.inWorkspace(uri)) this.scheduleRefresh(); }),
      this.watcher.onDidChange(uri => { if (this.inWorkspace(uri)) this.scheduleRefresh(); }),
    );
    if (this.visible) this.scheduleRefresh();
  }

  public refresh(): void {
    this.hasScanned = false;
    this.cancelScan();
    if (this.visible) void this.scan();
  }

  private inWorkspace(uri: vscode.Uri): boolean { return vscode.workspace.getWorkspaceFolder(uri) !== undefined; }

  private cancelScan(): void {
    this.version++;
    this.activeScan?.token.cancel();
    this.activeScan?.token.dispose();
    this.activeScan = undefined;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private scheduleRefresh(): void {
    this.hasScanned = false;
    this.cancelScan();
    if (this.visible && !this.disposed) {
      this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; void this.scan(); }, 180);
    }
  }

  private async scan(): Promise<void> {
    if (this.disposed || !this.visible) return;
    this.cancelScan();
    const active: ActiveScan = { token: new vscode.CancellationTokenSource(), version: this.version };
    this.activeScan = active;
    const current = () => this.activeScan === active && active.version === this.version && !active.token.token.isCancellationRequested && !this.disposed;
    this.status = 'Scanning workspace…';
    this.tree.message = undefined;
    this.roots = [];
    this.changed.fire(undefined);
    const rows: MatchRow[] = [];
    let skipped = 0;
    let truncated = false;

    try {
      const candidates = new Map<string, { uri: vscode.Uri; document?: vscode.TextDocument }>();
      for (const document of vscode.workspace.textDocuments) {
        if (!document.isClosed && this.inWorkspace(document.uri)) candidates.set(document.uri.toString(), { uri: document.uri, document });
      }
      if (candidates.size >= this.maxFiles) {
        truncated = candidates.size > this.maxFiles;
      } else {
        const files = await vscode.workspace.findFiles('**/*', undefined, this.maxFiles + 1, active.token.token);
        if (!current()) return;
        for (const uri of files) {
          const key = uri.toString();
          if (!candidates.has(key)) candidates.set(key, { uri });
        }
        truncated = files.length > this.maxFiles || candidates.size > this.maxFiles;
      }
      truncated ||= candidates.size > this.maxFiles;

      let processed = 0;
      for (const candidate of candidates.values()) {
        if (!current()) return;
        if (processed++ >= this.maxFiles || rows.length >= this.maxMatches) { truncated = true; break; }
        try {
          const document = candidate.document || await vscode.workspace.openTextDocument(candidate.uri);
          if (!current()) return;
          const matches = this.adapter.getDocumentMatches(document);
          for (const match of matches) {
            if (rows.length >= this.maxMatches) { truncated = true; break; }
            rows.push({ uri: candidate.uri, match });
          }
        } catch { skipped++; }
      }

      if (!current()) return;
      const grouped = new Map<string, TreeNode[]>();
      for (const row of rows) {
        const key = row.uri.toString();
        let children = grouped.get(key);
        if (!children) grouped.set(key, children = []);
        children.push({ label: `L${row.match.startLine + 1}: ${row.match.matchedText}`, uri: row.uri, range: new vscode.Range(row.match.startLine, row.match.startChar, row.match.endLine, row.match.endChar) });
      }
      this.roots = [...grouped].map(([key, children]) => ({
        label: vscode.workspace.asRelativePath(children[0].uri!, true),
        children: children.sort((a, b) => (a.range?.start.line || 0) - (b.range?.start.line || 0)),
        description: String(children.length),
      }));
      this.status = rows.length ? `${rows.length} matches${skipped ? `; skipped ${skipped} unreadable file(s)` : ''}` : skipped ? `No matches; skipped ${skipped} unreadable file(s)` : 'No keyword matches found';
      if (truncated) this.tree.message = `Results limited to ${this.maxFiles} files or ${this.maxMatches} matches`;
      else if (skipped) this.tree.message = `Skipped ${skipped} unreadable file(s)`;
      if (!this.roots.length) this.roots = [{ label: this.status }];
      this.hasScanned = true;
      this.changed.fire(undefined);
    } catch (error) {
      if (current()) {
        this.status = `Could not scan workspace: ${String(error)}`;
        this.roots = [{ label: this.status }];
        this.changed.fire(undefined);
      }
    } finally {
      if (this.activeScan === active) { this.activeScan = undefined; active.token.dispose(); }
    }
  }

  private async open(uri: vscode.Uri, range: vscode.Range): Promise<void> {
    try {
      const editor = await vscode.window.showTextDocument(uri, { preview: false });
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch (error) { vscode.window.showErrorMessage(`Could not open match: ${String(error)}`); }
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelScan();
    this.disposables.forEach(disposable => disposable.dispose());
  }
}
