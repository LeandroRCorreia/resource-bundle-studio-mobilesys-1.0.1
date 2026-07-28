import { PropertiesFile } from './types';
import { toUnicodeEscapes } from './utils/unicodeUtils';

export interface SerializeOptions {
  /** Sort keys alphabetically before writing. */
  sortKeys?: boolean;
  /** Convert non-ASCII characters to \uXXXX escapes. */
  convertUnicode?: boolean;
  /** Wrap values at this column (0 = disabled). */
  lineWrapLength?: number;
  /** Use CRLF line endings. */
  crlf?: boolean;
  /** Spaces used by Eclipse for continuation lines. */
  lineWrapIndent?: number;
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
    sortKeys = true,
    convertUnicode = true,
    lineWrapLength = 0,
    crlf = true,
    lineWrapIndent = 8,
  } = options;

  const eol = crlf ? '\r\n' : file.lineEnding;
  const keys = sortKeys
    ? [...file.keyOrder].sort()
    : [...file.keyOrder];

  const lines: string[] = [];
  let previousGroup: string | null | undefined;

  for (const key of keys) {
    const entry = file.entries.get(key);
    if (!entry) { continue; }

    const group = key.includes('.') ? key.slice(0, key.indexOf('.')) : null;
    if (group === null || group !== previousGroup) {
      lines.push('');
      previousGroup = group;
    }

    // Re-attach comment block
    if (entry.comment) {
      for (const commentLine of entry.comment.split(/\r\n|\n|\r/)) {
        lines.push(commentLine);
      }
    }

    const serializedKey = serializeKey(key, convertUnicode);
    const equalColumn = getEqualColumn(key, group, keys);
    const padding = ' '.repeat(Math.max(1, equalColumn - key.length + 1));
    const serializedValue = serializeValue(entry.value, convertUnicode);

    const prefix = `${serializedKey}${padding}= `;
    const kvLine = `${prefix}${serializedValue}`;

    if (lineWrapLength > 0 && kvLine.length > lineWrapLength) {
      lines.push(...wrapLine(prefix, serializedValue, lineWrapLength, lineWrapIndent));
    } else {
      lines.push(kvLine);
    }
  }

  if (file.standaloneComments.length > 0) {
    lines.push('', ...file.standaloneComments);
  }

  return lines.join(eol) + eol;
}

function serializeValue(value: string, convertUnicode: boolean): string {
  let serialized = value
    .replaceAll('\\', '\\\\')
    .replaceAll('\r', String.raw`\r`)
    .replaceAll('\n', String.raw`\n`);

  if (convertUnicode) {
    serialized = toUnicodeEscapes(serialized);
  } else {
    serialized = serialized
      .replaceAll('\t', String.raw`\t`)
      .replaceAll('\f', String.raw`\f`);
  }

  return serialized.startsWith(' ') ? `\\${serialized}` : serialized;
}

function serializeKey(key: string, convertUnicode: boolean): string {
  let serialized = '';

  for (let i = 0; i < key.length; i++) {
    const character = key[i];
    const code = key.charCodeAt(i);

    if (convertUnicode && (code < 0x20 || code > 0x7e)) {
      serialized += String.raw`\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
    } else {
      if ('=	\f#!: '.includes(character) || character === '\\') {
        serialized += '\\';
      }
      serialized += character;
    }
  }

  return serialized;
}

function getEqualColumn(
  key: string,
  group: string | null,
  keys: string[]
): number {
  if (group === null) { return key.length; }

  return keys
    .filter((candidate) => candidate.startsWith(`${group}.`))
    .reduce((max, candidate) => Math.max(max, candidate.length), key.length);
}

/**
 * Wrap a long value across multiple continuation lines.
 * The key=first_chunk is on line 1; subsequent chunks are indented.
 */
function wrapLine(
  prefix: string,
  value: string,
  wrapAt: number,
  indentSize: number
): string[] { // NOSONAR typescript:S3776
  const result: string[] = [];
  const indent = ' '.repeat(indentSize);
  let remaining = value;
  let isFirst = true;

  while (remaining.length > 0) {
    const availableWidth = wrapAt - (isFirst ? prefix.length : indentSize);
    if (availableWidth <= 0 || remaining.length <= availableWidth) {
      result.push(isFirst ? `${prefix}${remaining}` : `${indent}${remaining}`);
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
    result.push(isFirst ? `${prefix}${chunk}\\` : `${indent}${chunk}\\`);
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
