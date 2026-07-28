import * as vscode from 'vscode';
import * as path from 'node:path';
import { EDITOR_VIEW_TYPE } from './constants';
import { parseBundleFilename } from './utils/bundleUtils';

// -- Tree node types ----------------------------------------------------------

type NodeKind = 'bundle' | 'locale';

class BundleNode extends vscode.TreeItem {
  kind: NodeKind = 'bundle';
  constructor(
    public readonly baseName: string,
    public readonly folderUri: vscode.Uri,
    public readonly localeUris: Map<string, vscode.Uri>
  ) {
    super(baseName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'bundleNode';
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    this.tooltip = folderUri.fsPath;
    const count = localeUris.size;
    this.description = `${count} locale${count === 1 ? '' : 's'}`;
  }
}

class LocaleNode extends vscode.TreeItem {
  kind: NodeKind = 'locale';
  constructor(
    public readonly locale: string,
    public readonly uri: vscode.Uri
  ) {
    const label = locale === '' ? '(default)' : locale;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'localeNode';
    this.iconPath = new vscode.ThemeIcon('globe');
    this.description = path.basename(uri.fsPath);
    this.tooltip = uri.fsPath;
    this.resourceUri = uri;
    this.command = {
      command: 'vscode.openWith',
      title: 'Open Resource Bundle',
      arguments: [uri, EDITOR_VIEW_TYPE],
    };
  }
}

// -- Provider -----------------------------------------------------------------

export class ResourceBundleExplorer
  implements vscode.TreeDataProvider<BundleNode | LocaleNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    BundleNode | LocaleNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private bundles: BundleNode[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.refresh(); // NOSONAR typescript:S7059

    // Watch for .properties file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.properties');
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    context.subscriptions.push(watcher);
  }

  /** Re-scan all workspace folders for .properties files. */
  async refresh(): Promise<void> {
    this.bundles = await this.discoverBundles();
    this._onDidChangeTreeData.fire();
  }

  private async discoverBundles(): Promise<BundleNode[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const bundleMap = new Map<string, Map<string, vscode.Uri>>();
    // key = "folderPath::baseName", value = Map<locale, uri>

    for (const wf of folders) {
      // Walk the workspace folder recursively (up to 5 levels deep)
      await this.walkFolder(wf.uri, bundleMap, 0);
    }

    return [...bundleMap.entries()]
      .map(([compositeKey, localeUris]) => {
        const [folderPath, baseName] = compositeKey.split('::');
        const folderUri = vscode.Uri.file(folderPath);
        return new BundleNode(baseName, folderUri, localeUris);
      })
      .sort((a, b) => a.baseName.localeCompare(b.baseName));
  }

  private async walkFolder(
    uri: vscode.Uri,
    bundleMap: Map<string, Map<string, vscode.Uri>>,
    depth: number
  ): Promise<void> {
    if (depth > 5) { return; }

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(uri);
    } catch {
      return;
    }

    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory && !name.startsWith('.') && name !== 'node_modules') {
        await this.walkFolder(vscode.Uri.joinPath(uri, name), bundleMap, depth + 1);
      } else if (type === vscode.FileType.File && name.endsWith('.properties')) {
        const fileUri = vscode.Uri.joinPath(uri, name);
        const parsed = parseBundleFilename(fileUri);
        if (!parsed) { continue; }

        const compositeKey = `${uri.fsPath}::${parsed.baseName}`;
        if (!bundleMap.has(compositeKey)) {
          bundleMap.set(compositeKey, new Map());
        }
        bundleMap.get(compositeKey)!.set(parsed.locale, fileUri);
      }
    }
  }

  // -- TreeDataProvider implementation ---------------------------------------

  getTreeItem(element: BundleNode | LocaleNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BundleNode | LocaleNode): (BundleNode | LocaleNode)[] {
    if (!element) {
      return this.bundles;
    }
    if (element instanceof BundleNode) {
      return [...element.localeUris.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([locale, uri]) => new LocaleNode(locale, uri));
    }
    return [];
  }
}
