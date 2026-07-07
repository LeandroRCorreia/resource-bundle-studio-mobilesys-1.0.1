import * as vscode from 'vscode';
import { ResourceBundleStudioProvider } from './ResourceBundleStudioProvider';
import { ResourceBundleExplorer } from './ResourceBundleExplorer';
import { registerCommands } from './commands/index';

export function activate(context: vscode.ExtensionContext): void {
  // Register the custom editor provider
  const editorProviderDisposable = ResourceBundleStudioProvider.register(context);
  context.subscriptions.push(editorProviderDisposable);

  // Register the sidebar explorer tree view
  const explorer = new ResourceBundleExplorer(context);
  const treeView = vscode.window.createTreeView('resourceBundleExplorer', {
    treeDataProvider: explorer,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Register all palette / context-menu commands
  // The provider instance is passed so commands can trigger webview refreshes
  const provider = new ResourceBundleStudioProvider(context);
  registerCommands(context, provider, explorer);

  // Watch workspace config changes and notify open editors
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('resourceBundleStudio')) {
        vscode.commands.executeCommand('resourceBundleStudio.refresh');
      }
    })
  );

  console.log('Resource Bundle Studio is now active.');
}

export function deactivate(): void {
  // Nothing to clean up — all disposables are registered on context.subscriptions
}
