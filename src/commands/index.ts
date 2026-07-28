import * as vscode from 'vscode';
import * as path from 'node:path';
import { EDITOR_VIEW_TYPE, EXTENSION_ID } from '../constants';
import { ResourceBundleStudioProvider } from '../ResourceBundleStudioProvider';
import { ResourceBundleExplorer } from '../ResourceBundleExplorer';
import {
  loadBundle,
  mergeKeys,
  sortedLocales,
  findDuplicateKeys,
} from '../utils/bundleUtils';
import {
  serializePropertiesFile,
} from '../PropertiesSerializer';
import {
  fromUnicodeEscapes,
} from '../utils/unicodeUtils';
import {
  writeFile,
  pickSaveUri,
  pickOpenUri,
  readFile,
} from '../utils/fileUtils';

export function registerCommands(
  context: vscode.ExtensionContext,
  provider: ResourceBundleStudioProvider,
  explorer: ResourceBundleExplorer
): void {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // -- Explorer refresh -------------------------------------------------------
  reg(`${EXTENSION_ID}.refresh`, () => explorer.refresh());

  // -- New Bundle Wizard -----------------------------------------------------
  reg(`${EXTENSION_ID}.newBundle`, async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      vscode.window.showErrorMessage('Open a workspace folder first.');
      return;
    }

    const baseName = await vscode.window.showInputBox({
      prompt: 'Base name for the new resource bundle (e.g. "messages")',
      validateInput: (v) =>
        /^[A-Za-z_]\w*$/.test(v) ? undefined : 'Use only letters, digits, underscores',
    });
    if (!baseName) { return; }

    const localesRaw = await vscode.window.showInputBox({
      prompt: 'Comma-separated locale tags to create (e.g. "en,fr,de")',
      value: 'en',
    });
    if (!localesRaw) { return; }

    const locales = localesRaw.split(',').map((l) => l.trim()).filter(Boolean);
    const folder = folders[0].uri;

    for (const locale of locales) {
        const filename =
        locale === '' ? `${baseName}.properties` : `${baseName}_${locale}.properties`;
      const uri = vscode.Uri.joinPath(folder, filename);
      await writeFile(uri, `# ${baseName} - ${locale || 'default'}\n`);
    }

    vscode.window.showInformationMessage(
      `Created ${locales.length} file(s) for bundle "${baseName}".`
    );
    await explorer.refresh();

    // Open the first file in the bundle editor
    const firstLocale = locales[0] ?? '';
    const firstFilename =
      firstLocale === '' ? `${baseName}.properties` : `${baseName}_${firstLocale}.properties`;
    const firstUri = vscode.Uri.joinPath(folder, firstFilename);
    await vscode.commands.executeCommand('vscode.openWith', firstUri, EDITOR_VIEW_TYPE);
  });

  // -- Add Locale ------------------------------------------------------------
  reg(`${EXTENSION_ID}.addLocale`, async () => {
    const activeUri = getActivePropertiesUri();
    if (!activeUri) { return; }

    const locale = await vscode.window.showInputBox({
      prompt: 'New locale tag (e.g. "fr", "zh_CN")',
      validateInput: (v) =>
        /^[a-z]{2,3}([_-][A-Z]{2,3})?$/.test(v) ? undefined : 'Use format: en or en_US',
    });
    if (!locale) { return; }

    const bundle = await loadBundle(activeUri);
    if (bundle.files.has(locale)) {
      vscode.window.showWarningMessage(`Locale "${locale}" already exists in this bundle.`);
      return;
    }

    const config = vscode.workspace.getConfiguration(EXTENSION_ID);
    const refLocale: string = config.get('defaultLocale', 'en');
    const allKeys = mergeKeys(bundle, refLocale);

    // Create a skeleton file with all keys and empty values
    const lines = allKeys.map((k) => `${k}=`);
    const newFilename = `${bundle.baseName}_${locale}.properties`;
    const newUri = vscode.Uri.joinPath(bundle.folder, newFilename);
    await writeFile(newUri, lines.join('\n') + '\n');

    vscode.window.showInformationMessage(`Created "${newFilename}" with ${allKeys.length} keys.`);
    await explorer.refresh();
    await vscode.commands.executeCommand('vscode.openWith', newUri, EDITOR_VIEW_TYPE);
  });

  // -- Open as Resource Bundle -----------------------------------------------
  reg(`${EXTENSION_ID}.openBundle`, async (uri: unknown) => {
    const target = uri instanceof vscode.Uri ? uri : getActivePropertiesUri();
    if (!target) { return; }
    await vscode.commands.executeCommand('vscode.openWith', target, EDITOR_VIEW_TYPE);
  });

  // -- Sort Keys -------------------------------------------------------------
  reg(`${EXTENSION_ID}.sortKeys`, async () => {
    const activeUri = getActivePropertiesUri();
    if (!activeUri) { return; }

    const bundle = await loadBundle(activeUri);
    const config = vscode.workspace.getConfiguration(EXTENSION_ID);
    const convertUnicode: boolean = config.get('convertUnicodeOnSave', false);

    for (const [, file] of bundle.files) {
      const serialized = serializePropertiesFile(file, {
        sortKeys: true,
        convertUnicode,
      });
      await writeFile(file.uri, serialized);
    }
    vscode.window.showInformationMessage('Keys sorted alphabetically across all locales.');
  });

  // -- Convert Non-ASCII → \uXXXX --------------------------------------------
  reg(`${EXTENSION_ID}.convertToUnicode`, async () => {
    const activeUri = getActivePropertiesUri();
    if (!activeUri) { return; }

    const bundle = await loadBundle(activeUri);
    for (const [, file] of bundle.files) {
      const serialized = serializePropertiesFile(file, { convertUnicode: true });
      await writeFile(file.uri, serialized);
    }
    vscode.window.showInformationMessage(String.raw`Non-ASCII characters converted to \uXXXX escapes.`);
  });

  // -- Convert \uXXXX → Characters -------------------------------------------
  reg(`${EXTENSION_ID}.convertFromUnicode`, async () => {
    const activeUri = getActivePropertiesUri();
    if (!activeUri) { return; }

    const bundle = await loadBundle(activeUri);
    for (const [, file] of bundle.files) {
      for (const [key, entry] of file.entries) {
        file.entries.set(key, {
          ...entry,
          value: fromUnicodeEscapes(entry.value),
        });
      }
      const serialized = serializePropertiesFile(file, { convertUnicode: false });
      await writeFile(file.uri, serialized);
    }
    vscode.window.showInformationMessage(String.raw`\uXXXX escapes converted to Unicode characters.`);
  });

  // -- Find Missing Translations ---------------------------------------------
  reg(`${EXTENSION_ID}.findMissing`, async () => {
    const activeUri = getActivePropertiesUri();
    if (!activeUri) { return; }

    const bundle = await loadBundle(activeUri);
    const config = vscode.workspace.getConfiguration(EXTENSION_ID);
    const refLocale: string = config.get('defaultLocale', 'en');
    const allKeys = mergeKeys(bundle, refLocale);

    const diagnosticCollection = vscode.languages.createDiagnosticCollection(EXTENSION_ID);
    context.subscriptions.push(diagnosticCollection);
    diagnosticCollection.clear();

    let totalMissing = 0;

    for (const [, file] of bundle.files) {
      const diagnostics: vscode.Diagnostic[] = [];
      for (const key of allKeys) {
        const entry = file.entries.get(key);
        if (!entry || entry.value.trim() === '') {
          totalMissing++;
          const range = new vscode.Range(0, 0, 0, 0);
          const diag = new vscode.Diagnostic(
            range,
            `Missing translation for key: "${key}"`,
            vscode.DiagnosticSeverity.Warning
          );
          diag.source = 'Resource Bundle Studio';
          diagnostics.push(diag);
        }
      }
      diagnosticCollection.set(file.uri, diagnostics);
    }

    if (totalMissing === 0) {
      vscode.window.showInformationMessage('✅ No missing translations found!');
    } else {
      vscode.window.showWarningMessage(
        `Found ${totalMissing} missing translation(s). Check the Problems panel.`
      );
      await vscode.commands.executeCommand('workbench.actions.view.problems');
    }
  });

  // -- Find Duplicate Keys ---------------------------------------------------
  reg(`${EXTENSION_ID}.findDuplicates`, async () => {
    const activeUri = getActivePropertiesUri();
    if (!activeUri) { return; }

    const bundle = await loadBundle(activeUri);
    const dupes = findDuplicateKeys(bundle);

    if (dupes.size === 0) {
      vscode.window.showInformationMessage('✅ No duplicate keys found!');
      return;
    }

    const items: string[] = [];
    for (const [locale, keys] of dupes) {
      const label = locale === '' ? '(default)' : locale;
      items.push(`${label}: ${keys.join(', ')}`);
    }

    await vscode.window.showQuickPick(items, {
      canPickMany: false,
      placeHolder: 'Duplicate keys found (read-only list)',
    });
  });

  // -- Export to CSV ---------------------------------------------------------
  reg(`${EXTENSION_ID}.exportCsv`, async () => {
    const activeUri = getActivePropertiesUri();
    if (!activeUri) { return; }

    const bundle = await loadBundle(activeUri);
    const config = vscode.workspace.getConfiguration(EXTENSION_ID);
    const refLocale: string = config.get('defaultLocale', 'en');
    const locales = sortedLocales(bundle, refLocale);
    const allKeys = mergeKeys(bundle, refLocale);

    const csvLines: string[] = [];
    // Header row
    csvLines.push(['key', ...locales].map(csvCell).join(','));
    // Data rows
    for (const key of allKeys) {
      const row = [key];
      for (const locale of locales) {
        row.push(bundle.files.get(locale)?.entries.get(key)?.value ?? '');
      }
      csvLines.push(row.map(csvCell).join(','));
    }

    const saveUri = await pickSaveUri(`${bundle.baseName}.csv`, { CSV: ['csv'] });
    if (!saveUri) { return; }

    await writeFile(saveUri, csvLines.join('\n') + '\n');
    vscode.window.showInformationMessage(`Exported ${allKeys.length} keys to ${path.basename(saveUri.fsPath)}.`);
  });

  // -- Import from CSV -------------------------------------------------------
  reg(`${EXTENSION_ID}.importCsv`, async () => {
    const uris = await pickOpenUri({ CSV: ['csv'] });
    if (!uris || uris.length === 0) { return; }

    const csvUri = uris[0];
    const text = await readFile(csvUri);
    const rows = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (rows.length < 2) {
      vscode.window.showErrorMessage('CSV file must have a header row and at least one data row.');
      return;
    }

    const headers = parseCSVRow(rows[0]);
    const keyCol = headers.indexOf('key');
    if (keyCol === -1) {
      vscode.window.showErrorMessage('CSV must have a "key" column in the header.');
      return;
    }

    const locales = headers.filter((_, i) => i !== keyCol);

    // Ask where to save
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { return; }
    const baseName = await vscode.window.showInputBox({
      prompt: 'Base name for the imported bundle',
      value: path.basename(csvUri.fsPath, '.csv'),
    });
    if (!baseName) { return; }

    const folder = folders[0].uri;

    // Build in-memory data per locale
    const localeData = new Map<string, string[]>();
    for (const locale of locales) { localeData.set(locale, []); }

    const keys: string[] = [];
    for (let i = 1; i < rows.length; i++) {
      const cols = parseCSVRow(rows[i]);
      const key = cols[keyCol] ?? '';
      if (!key) { continue; }
      keys.push(key);
      for (const element of locales) {
        const colIdx = headers.indexOf(element);
        localeData.get(element)!.push(`${key}=${cols[colIdx] ?? ''}`);
      }
    }

    // Write locale files
    for (const locale of locales) {
      const filename = locale === '' ? `${baseName}.properties` : `${baseName}_${locale}.properties`;
      const uri = vscode.Uri.joinPath(folder, filename);
      await writeFile(uri, localeData.get(locale)!.join('\n') + '\n');
    }

    vscode.window.showInformationMessage(
      `Imported ${keys.length} keys across ${locales.length} locale(s).`
    );
    await explorer.refresh();
  });
}

// -- Helpers ------------------------------------------------------------------

function getActivePropertiesUri(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.fileName.endsWith('.properties')) {
    return editor.document.uri;
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (tab?.input instanceof vscode.TabInputCustom) {
    return tab.input.uri;
  }
  vscode.window.showErrorMessage('No .properties file is currently active.');
  return undefined;
}

/** Wrap a CSV cell value in quotes and escape internal quotes. */
function csvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/** Parse a single CSV row respecting quoted fields. */
function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
