import * as vscode from 'vscode';

// -- Parsed data model --------------------------------------------------------

/** A single key=value pair plus its surrounding metadata. */
export interface PropertiesEntry {
  key: string;
  value: string;
  /** Leading comment lines (# or !) immediately above this key. */
  comment: string;
  /** 0-based line index of the key= line in the raw file. */
  line: number;
}

/** A fully parsed .properties file. */
export interface PropertiesFile {
  uri: vscode.Uri;
  /** Locale tag extracted from filename, e.g. "en", "en_US", or "" for default. */
  locale: string;
  /** Ordered key list (preserves original file order). */
  keyOrder: string[];
  /** Fast lookup map. */
  entries: Map<string, PropertiesEntry>;
  /** Raw lines kept for round-trip serialization of untouched sections. */
  rawLines: string[];
}

/** A group of .properties files sharing the same base name and folder. */
export interface ResourceBundle {
  /** E.g. "messages", "ApplicationResources". */
  baseName: string;
  folder: vscode.Uri;
  /** Locale tag → parsed file. Empty string key = default/root locale. */
  files: Map<string, PropertiesFile>;
}

// -- Webview message protocol -------------------------------------------------

export type MessageType =
  | 'init'
  | 'update'
  | 'edit'
  | 'addKey'
  | 'removeKey'
  | 'renameKey'
  | 'duplicateKey'
  | 'reorderKey'
  | 'copyValue'
  | 'ready'
  | 'requestRefresh'
  | 'showError'
  | 'showInfo';

export interface WebviewMessage<T = unknown> {
  type: MessageType;
  payload: T;
}

/** Sent from extension → webview to initialise or refresh the grid. */
export interface InitPayload {
  /** Sorted locale list (reference locale first). */
  locales: string[];
  /** All keys in display order. */
  keys: string[];
  /** Nested map: key → locale → value (empty string = missing). */
  values: Record<string, Record<string, string>>;
  /** key → comment text */
  comments: Record<string, string>;
  referenceLocale: string;
  config: WebviewConfig;
}

export interface WebviewConfig {
  highlightMissing: boolean;
  highlightSimilar: boolean;
  referenceLocale: string;
  keyGroupingSeparator: string;
  showStatisticsBar: boolean;
}

/** Sent from webview → extension when the user edits a cell. */
export interface EditPayload {
  key: string;
  locale: string;
  value: string;
}

/** Sent from webview → extension to add a new key. */
export interface AddKeyPayload {
  key: string;
  /** Optional initial values per locale. */
  values: Record<string, string>;
  /** Insert after this key (undefined = append). */
  afterKey?: string;
}

/** Sent from webview → extension to remove a key. */
export interface RemoveKeyPayload {
  keys: string[];
}

/** Sent from webview → extension to rename a key. */
export interface RenameKeyPayload {
  oldKey: string;
  newKey: string;
}

/** Sent from webview → extension to duplicate a key. */
export interface DuplicateKeyPayload {
  sourceKey: string;
  newKey: string;
}

/** Sent from webview → extension to reorder a key via drag-and-drop. */
export interface ReorderKeyPayload {
  key: string;
  afterKey: string | null;
}

/** Sent from webview → extension to copy a value across locales. */
export interface CopyValuePayload {
  key: string;
  fromLocale: string;
  toLocale: string;
}
