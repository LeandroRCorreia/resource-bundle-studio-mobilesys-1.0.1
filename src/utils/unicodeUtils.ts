/**
 * Converts every non-ASCII character in a string to a Java-style \uXXXX escape.
 * Used for Java ≤8 .properties files which require ISO-8859-1 encoding.
 */
export function toUnicodeEscapes(input: string): string {
  let result = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.codePointAt(i);
    if (code && code > 127) {
      result += String.raw`\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
    } else {
      result += input[i];
    }
  }
  return result;
}

/**
 * Decodes all \uXXXX escape sequences in a string back to their Unicode characters.
 */
export function fromUnicodeEscapes(input: string): string {
  return input.replaceAll(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCodePoint(Number.parseInt(hex, 16))
  );
}

/**
 * Escapes special characters that must be escaped in .properties values:
 * backslash, newline, carriage return, tab, form feed.
 * Does NOT escape the key separator (= or :) inside values.
 */
export function escapeValue(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', String.raw`\n`)
    .replaceAll('\r', String.raw`\r`)
    .replaceAll('\t', String.raw`\t`)
    .replaceAll('\f', String.raw`\f`);
}

/**
 * Unescapes special sequences in a parsed value string.
 */
export function unescapeValue(value: string): string {
  return value
    .replaceAll(String.raw`\n`, '\n')
    .replaceAll(String.raw`\r`, '\r')
    .replaceAll(String.raw`\t`, '\t')
    .replaceAll(String.raw`\f`, '\f')
    .replaceAll('\\\\', '\\')
    .replaceAll(String.raw`\ `, ' ');
}

/**
 * Escapes a key so it can be written safely to a .properties file.
 * Spaces, '=', ':', '#', '!' at the start need escaping.
 */
export function escapeKey(key: string): string {
  return key
    .replaceAll('\\', '\\\\')
    .replaceAll(/\s/g, String.raw`\ `)
    .replaceAll('=', String.raw`\=`)
    .replaceAll(':', String.raw`\:`)
    .replaceAll(/^[#!]/g, String.raw`\$&`);
}
