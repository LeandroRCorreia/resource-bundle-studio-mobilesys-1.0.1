import * as vscode from 'vscode';
import * as path from 'node:path';
import { BUNDLE_FILE_REGEX } from '../constants';
import { ResourceBundle } from '../types';
import { listPropertiesFiles } from './fileUtils';
import { parsePropertiesFile } from '../PropertiesParser';

/**
 * Given a .properties URI, return the { baseName, locale } extracted from the filename.
 * Returns null if the filename doesn't match the expected pattern.
 */
export function parseBundleFilename(
  uri: vscode.Uri
): { baseName: string; locale: string } | null {
  const filename = path.basename(uri.fsPath);
  const match = new RegExp(BUNDLE_FILE_REGEX).exec(filename);
  if (!match) { return null; }
  return { baseName: match[1], locale: match[2] ?? '' };
}

/**
 * Discover and parse all .properties files in the same folder that share
 * the same base name as the given URI, and return a ResourceBundle.
 */
export async function loadBundle(uri: vscode.Uri): Promise<ResourceBundle> {
  const parsed = parseBundleFilename(uri);
  if (!parsed) {
    throw new Error(`Cannot determine bundle base name for: ${uri.fsPath}`);
  }

  const { baseName } = parsed;
  const folderUri = uri.with({ path: path.dirname(uri.fsPath) });
  const allFiles = await listPropertiesFiles(folderUri);

  // Keep only files that belong to this bundle
  const bundleFiles = allFiles.filter((f) => {
    const p = parseBundleFilename(f);
    return p !== null && p.baseName === baseName;
  });

  const bundle: ResourceBundle = {
    baseName,
    folder: folderUri,
    files: new Map(),
  };

  await Promise.all(
    bundleFiles.map(async (fileUri) => {
      const p = parseBundleFilename(fileUri)!;
      const propertiesFile = await parsePropertiesFile(fileUri, p.locale);
      bundle.files.set(p.locale, propertiesFile);
    })
  );

  return bundle;
}

/**
 * Return the union of all keys across all locale files, preserving the order
 * from the reference locale where possible, then appending any extras.
 */
export function mergeKeys(
  bundle: ResourceBundle,
  referenceLocale: string
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  // Reference locale first (to preserve canonical ordering)
  const refFile = bundle.files.get(referenceLocale) ?? bundle.files.values().next().value;
  if (refFile) {
    for (const key of refFile.keyOrder) {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }

  // Append any keys that exist only in other locales
  for (const [locale, file] of bundle.files) {
    if (locale === referenceLocale) { continue; }
    for (const key of file.keyOrder) {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }

  return ordered;
}

/**
 * Return sorted locale tags, with the reference locale first.
 */
export function sortedLocales(
  bundle: ResourceBundle,
  referenceLocale: string
): string[] {
  const locales = [...bundle.files.keys()].sort((a, b) => a.localeCompare(b));
  const idx = locales.indexOf(referenceLocale);
  if (idx > 0) {
    locales.splice(idx, 1);
    locales.unshift(referenceLocale);
  }
  return locales;
}

/**
 * Compute per-locale missing-key counts.
 * Returns a map of locale → number of missing keys.
 */
export function computeMissingCounts(
  bundle: ResourceBundle,
  allKeys: string[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [locale, file] of bundle.files) {
    let missing = 0;
    for (const key of allKeys) {
      const entry = file.entries.get(key);
      if (!entry || entry.value.trim() === '') { missing++; }
    }
    counts.set(locale, missing);
  }
  return counts;
}

/**
 * Find duplicate keys within a single locale file.
 */
export function findDuplicateKeys(bundle: ResourceBundle): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [locale, file] of bundle.files) {
    // The parser already de-dupes by keeping last occurrence;
    // re-scan raw lines to count real occurrences.
    const keyCounts = new Map<string, number>();
    for (const line of file.rawLines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#') || trimmed.startsWith('!') || !trimmed.includes('=')) {
        continue;
      }
      const eqIdx = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIdx).trimEnd();
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
    const dupes = [...keyCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key);
    if (dupes.length > 0) { result.set(locale, dupes); }
  }
  return result;
}
