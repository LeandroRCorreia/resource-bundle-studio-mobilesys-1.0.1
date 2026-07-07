import { PropertiesFile } from './types';
import { escapeKey, escapeValue, toUnicodeEscapes } from './utils/unicodeUtils';

export interface SerializeOptions {
  /** Sort keys alphabetically before writing. */
  sortKeys?: boolean;
  /** Convert non-ASCII characters to \uXXXX escapes. */
  convertUnicode?: boolean;
  /** Wrap values at this column (0 = disabled). */
  lineWrapLength?: number;
  /** Use CRLF line endings. */
  crlf?: boolean;
}

/**
 * Serialize a PropertiesFile back to a string, ready to be written to disk.
 * Comment blocks are preserved and re-attached to their keys.
 */
export function serializePropertiesFile( // NOSONAR typescript:S3776
  file: PropertiesFile,
  options: SerializeOptions = {}
): string {
  const {
    sortKeys = false,
    convertUnicode = false,
    lineWrapLength = 0,
    crlf = false,
  } = options;

  const eol = crlf ? '\r\n' : '\n';
  const keys = sortKeys
    ? [...file.keyOrder].sort((a, b) => a.localeCompare(b))
    : [...file.keyOrder];

  const lines: string[] = [];

  for (const key of keys) {
    const entry = file.entries.get(key);
    if (!entry) { continue; }

    // Re-attach comment block
    if (entry.comment) {
      // Preserve blank line before comment block (unless it's the first entry)
      if (lines.length > 0) {
        lines.push('');
      }
      for (const commentLine of entry.comment.split('\n')) {
        lines.push(commentLine);
      }
    }

    const serializedKey = escapeKey(key);
    let serializedValue = escapeValue(entry.value);
    if (convertUnicode) {
      serializedValue = toUnicodeEscapes(serializedValue);
    }

    const kvLine = `${serializedKey}=${serializedValue}`;

    if (lineWrapLength > 0 && kvLine.length > lineWrapLength) {
      lines.push(...wrapLine(serializedKey, serializedValue, lineWrapLength));
    } else {
      lines.push(kvLine);
    }
  }

  return lines.join(eol) + eol;
}

/**
 * Wrap a long value across multiple continuation lines.
 * The key=first_chunk is on line 1; subsequent chunks are indented.
 */
function wrapLine(key: string, value: string, wrapAt: number): string[] { // NOSONAR typescript:S3776
  const result: string[] = [];
  const prefix = `${key}=`;
  let remaining = value;
  let isFirst = true;

  while (remaining.length > 0) {
    const availableWidth = wrapAt - (isFirst ? prefix.length : 4);
    if (availableWidth <= 0 || remaining.length <= availableWidth) {
      result.push(isFirst ? `${prefix}${remaining}` : `    ${remaining}`);
      break;
    }

    // Don't split inside a \uXXXX sequence or escape sequence
    let splitAt = availableWidth;
    while (splitAt > 0) { // NOSONAR typescript:S1751
      const ch = remaining[splitAt - 1];
      if (ch === '\\') { splitAt--; break; }
      // Check if we're in the middle of a \uXXXX sequence
      const backslashPos = remaining.lastIndexOf('\\', splitAt - 1);
      if (backslashPos >= 0 && remaining[backslashPos + 1] === 'u') {
        const seqEnd = backslashPos + 6;
        if (splitAt > backslashPos && splitAt < seqEnd) {
          splitAt = backslashPos;
          break;
        }
      }
      break;
    }

    const chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt);
    result.push(isFirst ? `${prefix}${chunk}\\` : `    ${chunk}\\`);
    isFirst = false;
  }

  return result;
}

/**
 * Apply a single in-memory edit to a PropertiesFile (mutates the file object).
 */
export function applyEdit(
  file: PropertiesFile,
  key: string,
  newValue: string
): void {
  const existing = file.entries.get(key);
  if (existing) {
    file.entries.set(key, { ...existing, value: newValue });
  } else {
    // New key — append to the end
    file.keyOrder.push(key);
    file.entries.set(key, { key, value: newValue, comment: '', line: -1 });
  }
}

/**
 * Remove a key from a PropertiesFile (mutates).
 */
export function applyRemove(file: PropertiesFile, key: string): void {
  file.entries.delete(key);
  const idx = file.keyOrder.indexOf(key);
  if (idx !== -1) { file.keyOrder.splice(idx, 1); }
}

/**
 * Rename a key in a PropertiesFile (mutates, preserves order and comment).
 */
export function applyRename(
  file: PropertiesFile,
  oldKey: string,
  newKey: string
): void {
  const entry = file.entries.get(oldKey);
  if (!entry) { return; }

  file.entries.delete(oldKey);
  file.entries.set(newKey, { ...entry, key: newKey });

  const idx = file.keyOrder.indexOf(oldKey);
  if (idx !== -1) { file.keyOrder[idx] = newKey; }
}

/**
 * Reorder a key so that it appears immediately after `afterKey`.
 * If afterKey is null, move it to the top.
 */
export function applyReorder(
  file: PropertiesFile,
  key: string,
  afterKey: string | null
): void {
  const idx = file.keyOrder.indexOf(key);
  if (idx === -1) { return; }
  file.keyOrder.splice(idx, 1);

  if (afterKey === null) {
    file.keyOrder.unshift(key);
  } else {
    const afterIdx = file.keyOrder.indexOf(afterKey);
    file.keyOrder.splice(afterIdx + 1, 0, key);
  }
}
