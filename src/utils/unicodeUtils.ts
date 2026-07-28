/**
 * Converts every non-ASCII character in a string to a Java-style \uXXXX escape.
 * Used for Java ≤8 .properties files which require ISO-8859-1 encoding.
 */
export function toUnicodeEscapes(input: string): string {
  let result = '';
  for (let i = 0; i < input.length; i++) {
    // Java .properties escapes UTF-16 code units, including surrogate pairs.
    const code = input.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
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
  let result = '';

  for (let i = 0; i < value.length; i++) {
    const current = value[i];
    if (current !== '\\' || i + 1 >= value.length) {
      result += current;
      continue;
    }

    const escaped = value[++i];
    switch (escaped) {
      case 'n': result += '\n'; break;
      case 'r': result += '\r'; break;
      case 't': result += '\t'; break;
      case 'f': result += '\f'; break;
      case 'u': {
        const hex = value.slice(i + 1, i + 5);
        if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
          result += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
        } else {
          result += String.raw`\u`;
        }
        break;
      }
      default:
        // Java Properties removes the escape marker for other characters.
        result += escaped;
    }
  }

  return result;
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
