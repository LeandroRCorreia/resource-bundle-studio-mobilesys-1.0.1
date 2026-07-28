# Resource Bundle Studio (Mobilesys)

Internal Mobilesys fork of [Resource Bundle Studio](https://github.com/maj2c/resource-bundle-studio),
distributed under the original MIT license. It provides a VS Code editor for Java
`.properties` resource bundles, with Eclipse-compatible formatting and a
side-by-side locale editor.

> Do not install this fork and the original extension simultaneously. They provide
> editors for the same file type and may compete for `.properties` files.

---

## Features

| Feature | Detail |
| --- | --- |
| **Side-by-side grid** | All locale files in one table. Edit any cell inline. |
| **Missing detection** | Red highlight + badge count per locale column. |
| **Similar detection** | Yellow highlight when a value matches the reference locale. |
| **Add / Rename / Duplicate / Remove** | Atomic — applied to every locale file at once. |
| **Drag-and-drop reorder** | Drag rows to reorder keys; all files stay in sync. |
| **Tree view** | Groups keys by dot-prefix with collapse / expand. |
| **Quick filter** | Live-narrow by key name or value text. |
| **Sort keys** | On-demand or automatically on every save. |
| **Unicode conversion** | Non-ASCII ↔ `\uXXXX` on-demand or on save. |
| **New bundle wizard** | Creates base + locale files from one dialog. |
| **Add locale** | Generates a skeleton `.properties` from all existing keys. |
| **Export / Import CSV** | Full bundle round-trip through a single CSV file. |
| **Find missing** | Populates the VS Code Problems panel with warnings. |
| **Find duplicates** | Lists duplicate keys per locale in Quick Pick. |
| **Sidebar explorer** | Groups all workspace bundles by base name. |
| **Comment preservation** | `#` / `!` comment text survives parse → serialize round-trips. |
| **Multi-line values** | Handles backslash line-continuation transparently. |
| **Auto-refresh** | Editor reloads when files change on disk. |

---

## Getting Started

### Install

This internal fork is distributed as a VSIX and is not installed from the public
Marketplace.

```bash
npm ci
npx @vscode/vsce package
code --install-extension ./resource-bundle-studio-mobilesys-1.0.1.vsix --force
```

Reload the VS Code window after installation.

### Open a bundle

1. Click any `.properties` file — the grid editor opens automatically.
2. Or right-click a `.properties` file → **Open as Resource Bundle**.
3. Or use the **Resource Bundles** sidebar in the Explorer panel.

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Double-click` / `Enter` / `F2` | Start editing a cell |
| `Enter` (in editor) | Commit edit |
| `Shift+Enter` (in editor) | Insert newline in value |
| `Escape` | Cancel edit |
| `Tab` / `Shift+Tab` | Move to next / previous cell |
| `Ctrl+N` / `Cmd+N` | Add new key |
| `F2` (row selected) | Rename selected key |

---

## Configuration

All settings live under `mobilesys.resourceBundleStudio.*` in VS Code Settings.

| Setting | Default | Description |
| --- | --- | --- |
| `defaultLocale` | `"en"` | Reference locale — shown first, used for similarity comparison |
| `highlightMissing` | `true` | Red background for empty/missing cells |
| `highlightSimilar` | `true` | Yellow background when value equals the reference locale |
| `sortKeysOnSave` | `true` | Sort keys alphabetically on every save |
| `convertUnicodeOnSave` | `true` | Convert non-ASCII to `\uXXXX` on every save |
| `keyGroupingSeparator` | `"."` | Separator for tree-view grouping |
| `lineWrapLength` | `0` | Wrap values at this column width (0 = off) |
| `lineWrapIndent` | `8` | Indentation used for wrapped continuation lines |
| `showStatisticsBar` | `true` | Toggle the bottom status bar |

The serializer preserves comment text, placeholders such as `{0}`, Java escapes,
accented characters, and values containing `=` or `:`. Blank-line placement is
normalized to Eclipse-style key grouping and is not preserved byte-for-byte.

---

## Bundle Detection

Files are grouped into a bundle when they share the same **base name** and **folder**.

| File | Base name | Locale |
| --- | --- | --- |
| `messages.properties` | `messages` | *(default)* |
| `messages_en.properties` | `messages` | `en` |
| `messages_en_US.properties` | `messages` | `en_US` |
| `messages_zh_CN.properties` | `messages` | `zh_CN` |

---

## CSV Format

The exported CSV uses the key as the first column, followed by one column per locale:

```csv
key,en,fr,de
button.save,Save,Enregistrer,Speichern
button.cancel,Cancel,Annuler,Abbrechen
error.required,Required,,Pflichtfeld
```

Empty cells represent missing translations.

---

## Architecture

```text
Extension host (Node.js)                Webview (sandboxed browser)
-------------------------               ----------------------------
ResourceBundleStudioProvider            main.ts
  └- openCustomDocument()    --init--▶  renderGrid()
  └- resolveCustomEditor()   ◀--edit--  startEdit() → commitEdit()
  └- handleWebviewMessage()  --update▶  renderGrid()
       │
       ├- PropertiesParser      (parse .properties → PropertiesFile)
       ├- PropertiesSerializer  (PropertiesFile → string on disk)
       └- bundleUtils           (merge keys, sort locales, stats)

ResourceBundleExplorer   → sidebar TreeView
registerCommands         → palette + context-menu commands
```

---

## Contributing

1. Create a feature branch in the internal repository.
2. `npm ci` then `npm run watch` to compile in watch mode.
3. Press `F5` in VS Code to open the Extension Development Host.
4. Open any folder containing `.properties` files to test.
5. Run `npm run lint` before submitting a pull request.

---

## License

MIT © 2026 Resource Bundle Studio Contributors.

This fork preserves the license and credits of the
[original Resource Bundle Studio project](https://github.com/maj2c/resource-bundle-studio).
Mobilesys maintains the internal fork-specific changes.
