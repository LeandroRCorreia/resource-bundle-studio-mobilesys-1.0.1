export const EXTENSION_ID = 'resourceBundleStudio';
export const EDITOR_VIEW_TYPE = `${EXTENSION_ID}.editor`;
export const EXPLORER_VIEW_ID = 'resourceBundleExplorer';

/** Regex that matches a .properties filename and captures baseName + locale.
 *  Handles: messages.properties  messages_en.properties  messages_en_US.properties
 */
export const BUNDLE_FILE_REGEX =
  /^(.+?)(?:_([a-z]{2,3}(?:[_-][A-Z]{2,3}(?:[_-][A-Za-z]+)?)?))?\.properties$/; // NOSONAR typescript:S5843

export const WEBVIEW_SCRIPT = 'webview.js';
export const WEBVIEW_STYLES = 'styles.css';
