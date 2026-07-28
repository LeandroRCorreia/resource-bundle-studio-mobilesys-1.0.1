import * as vscode from 'vscode';
import { EDITOR_VIEW_TYPE, EXTENSION_ID, WEBVIEW_SCRIPT, WEBVIEW_STYLES } from './constants';
import { ResourceBundle, InitPayload, WebviewMessage, EditPayload,
         AddKeyPayload, RemoveKeyPayload, RenameKeyPayload,
         DuplicateKeyPayload, ReorderKeyPayload, CopyValuePayload } from './types';
import { loadBundle, mergeKeys, sortedLocales } from './utils/bundleUtils';
import {
  serializePropertiesFile,
  applyEdit,
  applyRemove,
  applyRename,
  applyReorder,
} from './PropertiesSerializer';
import { writeFile } from './utils/fileUtils';

export class ResourceBundleStudioProvider
  implements vscode.CustomEditorProvider<BundleDocument>
{
  private readonly _onDidChangeCustomDocument =
    new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BundleDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      EDITOR_VIEW_TYPE,
      new ResourceBundleStudioProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  // -- Document lifecycle ----------------------------------------------------

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<BundleDocument> {
    const bundle = await loadBundle(uri);
    const doc = new BundleDocument(uri, bundle);

    // Watch all files in this bundle for external changes
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        bundle.folder,
        `${bundle.baseName}*.properties`
      )
    );
    watcher.onDidChange(async () => {
      await doc.reload();
      doc.postMessageToAllPanels({ type: 'update', payload: await this.buildInitPayload(doc.bundle) });
    });
    doc.disposables.push(watcher);

    return doc;
  }

  async resolveCustomEditor(
    document: BundleDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      ],
    };

    webviewPanel.webview.html = this.buildWebviewHtml(webviewPanel.webview);
    document.addPanel(webviewPanel);

    // -- Receive messages from webview ---------------------------------------
    webviewPanel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        try {
          await this.handleWebviewMessage(document, webviewPanel, message);
        } catch (err) {
          vscode.window.showErrorMessage(`Resource Bundle Studio: ${String(err)}`);
        }
      },
      undefined,
      document.disposables
    );

    // Send initial data once the webview signals it is ready
    webviewPanel.webview.onDidReceiveMessage(
      async (msg: WebviewMessage) => {
        if (msg.type === 'ready') {
          const payload = await this.buildInitPayload(document.bundle);
          webviewPanel.webview.postMessage({ type: 'init', payload });
        }
      },
      undefined,
      document.disposables
    );

    webviewPanel.onDidDispose(() => document.removePanel(webviewPanel));
  }

  // -- Message handler -------------------------------------------------------

  private async handleWebviewMessage( // NOSONAR typescript:S3776
    document: BundleDocument,
    _panel: vscode.WebviewPanel,
    message: WebviewMessage
  ): Promise<void> {
    const bundle = document.bundle;
    const config = vscode.workspace.getConfiguration(EXTENSION_ID);
    const serializeOpts = {
      sortKeys: config.get<boolean>('sortKeysOnSave', true),
      convertUnicode: config.get<boolean>('convertUnicodeOnSave', true),
      lineWrapLength: config.get<number>('lineWrapLength', 0),
      lineWrapIndent: config.get<number>('lineWrapIndent', 8),
      crlf: true,
    };

    switch (message.type) {

      // -- Cell edit ----------------------------------------------------------
      case 'edit': {
        const { key, locale, value } = message.payload as EditPayload;
        const file = bundle.files.get(locale);
        if (!file) { return; }
        applyEdit(file, key, value);
        await writeFile(file.uri, serializePropertiesFile(file, serializeOpts));
        this.fireChange(document, `edit:${key}:${locale}`);
        // Broadcast updated payload to all panels so sibling panels stay in sync
        document.postMessageToAllPanels({
          type: 'update',
          payload: await this.buildInitPayload(bundle),
        });
        break;
      }

      // -- Add key ------------------------------------------------------------
      case 'addKey': {
        const { key, values, afterKey } = message.payload as AddKeyPayload;

        if (this.keyExists(bundle, key)) {
          document.postMessageToAllPanels({
            type: 'showError',
            payload: `Key "${key}" already exists.`,
          });
          return;
        }

        for (const [locale, file] of bundle.files) {
          const value = values[locale] ?? '';
          applyEdit(file, key, value);
          if (afterKey) {
            const afterIdx = file.keyOrder.indexOf(afterKey);
            if (afterIdx !== -1) {
              // Move newly appended key to just after afterKey
              file.keyOrder.pop();
              file.keyOrder.splice(afterIdx + 1, 0, key);
            }
          }
          await writeFile(file.uri, serializePropertiesFile(file, serializeOpts));
        }

        this.fireChange(document, `addKey:${key}`);
        document.postMessageToAllPanels({
          type: 'update',
          payload: await this.buildInitPayload(bundle),
        });
        break;
      }

      // -- Remove keys --------------------------------------------------------
      case 'removeKey': {
        const { keys } = message.payload as RemoveKeyPayload;
        for (const key of keys) {
          for (const [, file] of bundle.files) {
            applyRemove(file, key);
          }
        }
        for (const [, file] of bundle.files) {
          await writeFile(file.uri, serializePropertiesFile(file, serializeOpts));
        }
        this.fireChange(document, `removeKey:${keys.join(',')}`);
        document.postMessageToAllPanels({
          type: 'update',
          payload: await this.buildInitPayload(bundle),
        });
        break;
      }

      // -- Rename key ---------------------------------------------------------
      case 'renameKey': {
        const { oldKey, newKey } = message.payload as RenameKeyPayload;
        if (!oldKey || !newKey || oldKey === newKey) { return; }
        if (this.keyExists(bundle, newKey)) {
          document.postMessageToAllPanels({
            type: 'showError',
            payload: `Key "${newKey}" already exists.`,
          });
          return;
        }
        for (const [, file] of bundle.files) {
          applyRename(file, oldKey, newKey);
          await writeFile(file.uri, serializePropertiesFile(file, serializeOpts));
        }
        this.fireChange(document, `renameKey:${oldKey}->${newKey}`);
        document.postMessageToAllPanels({
          type: 'update',
          payload: await this.buildInitPayload(bundle),
        });
        break;
      }

      // -- Duplicate key ------------------------------------------------------
      case 'duplicateKey': {
        const { sourceKey, newKey } = message.payload as DuplicateKeyPayload;
        if (this.keyExists(bundle, newKey)) {
          document.postMessageToAllPanels({
            type: 'showError',
            payload: `Key "${newKey}" already exists.`,
          });
          return;
        }
        for (const [, file] of bundle.files) {
          const srcEntry = file.entries.get(sourceKey);
          applyEdit(file, newKey, srcEntry?.value ?? '');
          const srcIdx = file.keyOrder.indexOf(sourceKey);
          if (srcIdx !== -1) {
            file.keyOrder.pop();
            file.keyOrder.splice(srcIdx + 1, 0, newKey);
          }
          await writeFile(file.uri, serializePropertiesFile(file, serializeOpts));
        }
        this.fireChange(document, `duplicateKey:${sourceKey}->${newKey}`);
        document.postMessageToAllPanels({
          type: 'update',
          payload: await this.buildInitPayload(bundle),
        });
        break;
      }

      // -- Reorder key (drag-and-drop) ----------------------------------------
      case 'reorderKey': {
        const { key, afterKey } = message.payload as ReorderKeyPayload;
        for (const [, file] of bundle.files) {
          applyReorder(file, key, afterKey);
          if (key === '__sort__' && afterKey == null) {
            file.keyOrder.sort((a, b) => a.localeCompare(b));
          }
          await writeFile(file.uri, serializePropertiesFile(file, serializeOpts));
        }
        this.fireChange(document, `reorderKey:${key}`);
        document.postMessageToAllPanels({
          type: 'update',
          payload: await this.buildInitPayload(bundle),
        });
        break;
      }

      // -- Copy value across locales ------------------------------------------
      case 'copyValue': {
        const { key, fromLocale, toLocale } = message.payload as CopyValuePayload;
        const srcFile = bundle.files.get(fromLocale);
        const dstFile = bundle.files.get(toLocale);
        if (!srcFile || !dstFile) { return; }
        const value = srcFile.entries.get(key)?.value ?? '';
        applyEdit(dstFile, key, value);
        await writeFile(dstFile.uri, serializePropertiesFile(dstFile, serializeOpts));
        this.fireChange(document, `copyValue:${key}:${fromLocale}->${toLocale}`);
        document.postMessageToAllPanels({
          type: 'update',
          payload: await this.buildInitPayload(bundle),
        });
        break;
      }

      // -- Manual refresh request from webview -------------------------------
      case 'requestRefresh': {
        await document.reload();
        document.postMessageToAllPanels({
          type: 'update',
          payload: await this.buildInitPayload(document.bundle),
        });
        break;
      }
    }
  }

  // -- Helpers ---------------------------------------------------------------

  private keyExists(bundle: ResourceBundle, key: string): boolean {
    for (const [, file] of bundle.files) {
      if (file.entries.has(key)) { return true; }
    }
    return false;
  }

  private fireChange(document: BundleDocument, label: string): void {
    this._onDidChangeCustomDocument.fire({
      document,
      undo: async () => { /* undo handled by file reload */ },
      redo: async () => { /* redo handled by file reload */ },
      label,
    });
  }

  private async buildInitPayload(bundle: ResourceBundle): Promise<InitPayload> {
    const config = vscode.workspace.getConfiguration(EXTENSION_ID);
    const refLocale: string = config.get('defaultLocale', 'en');
    const locales = sortedLocales(bundle, refLocale);
    const keys = mergeKeys(bundle, refLocale);

    const values: Record<string, Record<string, string>> = {};
    const comments: Record<string, string> = {};

    for (const key of keys) {
      values[key] = {};
      for (const locale of locales) {
        values[key][locale] = bundle.files.get(locale)?.entries.get(key)?.value ?? '';
      }
      // Use comment from reference locale, fallback to first available
      const refFile = bundle.files.get(refLocale) ?? bundle.files.values().next().value;
      comments[key] = refFile?.entries.get(key)?.comment ?? '';
    }

    return {
      locales,
      keys,
      values,
      comments,
      referenceLocale: refLocale,
      config: {
        highlightMissing: config.get('highlightMissing', true),
        highlightSimilar: config.get('highlightSimilar', true),
        referenceLocale: refLocale,
        keyGroupingSeparator: config.get('keyGroupingSeparator', '.'),
        showStatisticsBar: config.get('showStatisticsBar', true),
      },
    };
  }

  // -- Custom document save / revert -----------------------------------------

  async saveCustomDocument(
    _document: BundleDocument,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    // Files are already written on every edit; this is a no-op but satisfies the API.
  }

  async saveCustomDocumentAs(
    _document: BundleDocument,
    _destination: vscode.Uri,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    // Not meaningfully applicable to a multi-file bundle.
    vscode.window.showInformationMessage(
      'Use "Export Bundle to CSV" to export the full bundle to a single file.'
    );
  }

  async revertCustomDocument(
    document: BundleDocument,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    await document.reload();
    document.postMessageToAllPanels({
      type: 'update',
      payload: await this.buildInitPayload(document.bundle),
    });
  }

  async backupCustomDocument(
    document: BundleDocument,
    context: vscode.CustomDocumentBackupContext,
    _cancellation: vscode.CancellationToken
  ): Promise<vscode.CustomDocumentBackup> {
    // Backup is not needed since we write-through on every edit.
    return { id: context.destination.toString(), delete: async () => {} };
  }

  // -- Webview HTML ----------------------------------------------------------

  private buildWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', WEBVIEW_SCRIPT)
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', WEBVIEW_STYLES)
    );
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${stylesUri}"/>
  <title>Resource Bundle Studio</title>
</head>
<body>
  <!-- Toolbar -->
  <div id="toolbar">
    <div id="toolbar-left">
      <input id="search-input" type="text" placeholder="🔍 Filter keys or values…" autocomplete="off"/>
      <label class="toggle-label">
        <input id="toggle-tree" type="checkbox"/>
        <span>Tree view</span>
      </label>
      <label class="toggle-label">
        <input id="toggle-missing" type="checkbox"/>
        <span>Missing only</span>
      </label>
    </div>
    <div id="toolbar-right">
      <button id="btn-add"       title="Add key (Ctrl+N)">＋ Add Key</button>
      <button id="btn-rename"    title="Rename selected key (F2)">✎ Rename</button>
      <button id="btn-duplicate" title="Duplicate selected key">⧉ Duplicate</button>
      <button id="btn-remove"    title="Delete selected key(s) (Del)">✕ Remove</button>
      <button id="btn-sort"      title="Sort all keys alphabetically">⇅ Sort</button>
      <button id="btn-refresh"   title="Reload from disk">↺ Refresh</button>
    </div>
  </div>

  <!-- Grid container -->
  <div id="grid-container">
    <table id="grid" cellspacing="0" cellpadding="0">
      <thead id="grid-head"></thead>
      <tbody id="grid-body"></tbody>
    </table>
  </div>

  <!-- Status bar -->
  <div id="status-bar">
    <span id="status-keys"></span>
    <span id="status-missing"></span>
    <span id="status-filter"></span>
  </div>

  <!-- Context menu -->
  <ul id="context-menu" class="context-menu hidden">
    <li data-action="rename">Rename key…</li>
    <li data-action="duplicate">Duplicate key…</li>
    <li data-action="remove" class="danger">Remove key(s)</li>
    <li class="separator"></li>
    <li data-action="copy-from">Copy value from locale…</li>
    <li data-action="add-after">Add key after this…</li>
  </ul>

  <!-- Modals -->
  <div id="modal-overlay" class="hidden">
    <div id="modal">
      <h3 id="modal-title"></h3>
      <div id="modal-body"></div>
      <div id="modal-footer">
        <button id="modal-ok">OK</button>
        <button id="modal-cancel">Cancel</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// -- BundleDocument ------------------------------------------------------------

export class BundleDocument implements vscode.CustomDocument {
  readonly disposables: vscode.Disposable[] = [];
  private readonly panels = new Set<vscode.WebviewPanel>();

  constructor(
    readonly uri: vscode.Uri,
    public bundle: ResourceBundle
  ) {}

  addPanel(panel: vscode.WebviewPanel): void {
    this.panels.add(panel);
  }

  removePanel(panel: vscode.WebviewPanel): void {
    this.panels.delete(panel);
  }

  postMessageToAllPanels(message: WebviewMessage): void {
    for (const panel of this.panels) {
      panel.webview.postMessage(message);
    }
  }

  async reload(): Promise<void> {
    const fresh = await loadBundle(this.uri);
    this.bundle = fresh;
  }

  dispose(): void {
    for (const d of this.disposables) { d.dispose(); }
    this.disposables.length = 0;
  }
}

// -- Nonce helper --------------------------------------------------------------

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length)); // NOSONAR typescript:S2245
  }
  return text;
}
