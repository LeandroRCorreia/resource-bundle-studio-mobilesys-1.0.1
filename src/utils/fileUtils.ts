import * as vscode from 'vscode';
import * as path from 'node:path';

/** Read a URI as a UTF-8 string. */
export async function readFile(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

/** Write a string to a URI as UTF-8. */
export async function writeFile(uri: vscode.Uri, content: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
}

/** Return true if the URI exists on disk. */
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** List all *.properties files inside a folder (non-recursive). */
export async function listPropertiesFiles(
  folderUri: vscode.Uri
): Promise<vscode.Uri[]> {
  const entries = await vscode.workspace.fs.readDirectory(folderUri);
  return entries
    .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.properties'))
    .map(([name]) => vscode.Uri.joinPath(folderUri, name));
}

/** Extract just the filename (without directory) from a URI. */
export function basename(uri: vscode.Uri): string {
  return path.basename(uri.fsPath);
}

/** Build a sibling URI in the same folder. */
export function sibling(uri: vscode.Uri, filename: string): vscode.Uri {
  return vscode.Uri.joinPath(uri.with({ path: path.dirname(uri.fsPath) }), filename);
}

/**
 * Show a SaveDialog and return the chosen URI, or undefined if cancelled.
 * Defaults to the workspace root and the given suggested filename.
 */
export async function pickSaveUri(
  defaultName: string,
  filters: Record<string, string[]>
): Promise<vscode.Uri | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const defaultUri = workspaceFolders
    ? vscode.Uri.joinPath(workspaceFolders[0].uri, defaultName)
    : undefined;
  return vscode.window.showSaveDialog({ defaultUri, filters });
}

/**
 * Show an OpenDialog and return the chosen URI array, or undefined.
 */
export async function pickOpenUri(
  filters: Record<string, string[]>
): Promise<vscode.Uri[] | undefined> {
  return vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Import',
    filters,
  });
}
