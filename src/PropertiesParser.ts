import * as vscode from 'vscode';
import { PropertiesEntry, PropertiesFile } from './types';
import { readFile } from './utils/fileUtils';
import { unescapeValue } from './utils/unicodeUtils';

/**
 * Full-featured parser for Java .properties files (RFC / java.util.Properties spec).
 *
 * Handles:
 *  - # and ! comment lines
 *  - Natural lines and logical lines (backslash line continuation)
 *  - Both = and : key separators, as well as whitespace-only separator
 *  - Unicode escape sequences (\uXXXX)
 *  - Leading whitespace on continuation lines is stripped
 *  - Blank lines are preserved in rawLines for round-trip fidelity
 *  - Duplicate keys: last value wins (matches java.util.Properties behavior)
 */
export async function parsePropertiesFile( // NOSONAR typescript:S3776
  uri: vscode.Uri,
  locale: string
): Promise<PropertiesFile> {
  const text = await readFile(uri);
  const lineEnding = text.match(/\r\n|\n|\r/)?.[0] as '\r\n' | '\n' | '\r' | undefined;
  const rawLines = text.split(/\r\n|\n|\r/);
  const entries = new Map<string, PropertiesEntry>();
  const keyOrder: string[] = [];
  const standaloneComments: string[] = [];

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    const trimmed = line.trimStart();

    // Skip blank lines
    if (trimmed === '') {
      i++;
      continue;
    }

    // Collect comment block
    if (trimmed.startsWith('#') || trimmed.startsWith('!')) {
      const commentLines: string[] = [];
      while (
        i < rawLines.length &&
        (rawLines[i].trimStart().startsWith('#') || rawLines[i].trimStart().startsWith('!'))
      ) {
        commentLines.push(rawLines[i]);
        i++;
      }

      // Peek at the next non-blank line: if it's a key=value, attach the comment
      let j = i;
      while (j < rawLines.length && rawLines[j].trim() === '') { j++; }

      if (j < rawLines.length) {
        const nextTrimmed = rawLines[j].trimStart();
        if (
          !nextTrimmed.startsWith('#') &&
          !nextTrimmed.startsWith('!') &&
          nextTrimmed.length > 0
        ) {
          // Comment will be attached when we parse the key below
          const { key, value, endLine } = parseKeyValue(rawLines, j);
          if (key !== null) {
            const comment = commentLines.join('\n');
            const existing = entries.has(key);
            entries.set(key, { key, value, comment, line: j });
            if (!existing) { keyOrder.push(key); }
            i = endLine + 1;
            continue;
          }
        }
      }
      // Standalone comments with no following key — just continue
      standaloneComments.push(...commentLines);
      continue;
    }

    // Key=value line
    const { key, value, endLine } = parseKeyValue(rawLines, i);
    if (key === null) {
      i++;
    } else {
      const existing = entries.has(key);
      entries.set(key, { key, value, comment: '', line: i });
      if (!existing) { keyOrder.push(key); }
      i = endLine + 1;
    }
  }

  return {
    uri,
    locale,
    keyOrder,
    entries,
    rawLines,
    standaloneComments,
    lineEnding: lineEnding ?? (process.platform === 'win32' ? '\r\n' : '\n'),
  };
}

/** Parse a logical line (handling backslash continuation) starting at `startIdx`. */
function parseKeyValue(
  lines: string[],
  startIdx: number
): { key: string | null; value: string; endLine: number } {
  let logical = '';
  let i = startIdx;

  while (i < lines.length) {
    const raw = i === startIdx ? lines[i] : lines[i].replace(/^[ \t\f]+/, '');
    const trailingBackslashes = raw.match(/\\+$/)?.[0].length ?? 0;
    if (trailingBackslashes % 2 === 0) {
      logical += raw;
      break;
    }

    logical += raw.slice(0, -1);
    i++;
  }

  // Now split logical line into key and value
  const trimmedLogical = logical.trimStart();
  if (trimmedLogical === '' || trimmedLogical.startsWith('#') || trimmedLogical.startsWith('!')) {
    return { key: null, value: '', endLine: i };
  }

  // Find the key: read until unescaped '=', ':', or whitespace
  let keyEnd = 0;
  while (keyEnd < trimmedLogical.length) {
    const ch = trimmedLogical[keyEnd];
    if (ch === '\\') {
      keyEnd += 2; // skip escaped character
      continue;
    }
    if (ch === '=' || ch === ':' || ch === ' ' || ch === '\t') {
      break;
    }
    keyEnd++;
  }

  const rawKey = trimmedLogical.slice(0, keyEnd);
  let rest = trimmedLogical.slice(keyEnd);

  // Skip the separator (optional whitespace, then = or :, then optional whitespace)
  rest = rest.trimStart();
  if (rest.startsWith('=') || rest.startsWith(':')) {
    rest = rest.slice(1).trimStart();
  }

  const key = unescapeValue(rawKey);
  const value = unescapeValue(rest);

  return { key, value, endLine: i };
}
