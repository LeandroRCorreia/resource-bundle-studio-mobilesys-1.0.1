# Resource Bundle Studio for VS Code

A full-featured editor for Java `.properties` resource bundle files,
bringing every capability of the classic Eclipse **ResourceBundle Editor** plugin
into VS Code — plus extras like CSV export, drag-and-drop reordering, and a
dedicated sidebar explorer.

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
| **Comment preservation** | `#` / `!` comment blocks survive parse → serialize round-trips. |
| **Multi-line values** | Handles backslash line-continuation transparently. |
| **Auto-refresh** | Editor reloads when files change on disk. |

---

## Getting Started

### Install

```bash
# From the VS Code Marketplace
ext install resource-bundle-studio

# Or build locally
git clone https://github.com/your-org/resource-bundle-studio
cd resource-bundle-studio
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```

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

All settings live under `resourceBundleStudio.*` in VS Code Settings.

| Setting | Default | Description |
| --- | --- | --- |
| `defaultLocale` | `"en"` | Reference locale — shown first, used for similarity comparison |
| `highlightMissing` | `true` | Red background for empty/missing cells |
| `highlightSimilar` | `true` | Yellow background when value equals the reference locale |
| `sortKeysOnSave` | `false` | Sort keys alphabetically on every save |
| `convertUnicodeOnSave` | `false` | Convert non-ASCII to `\uXXXX` on every save |
| `keyGroupingSeparator` | `"."` | Separator for tree-view grouping |
| `lineWrapLength` | `0` | Wrap values at this column width (0 = off) |
| `showStatisticsBar` | `true` | Toggle the bottom status bar |

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

1. Fork the repository and create a feature branch.
2. `npm install` then `npm run watch` to compile in watch mode.
3. Press `F5` in VS Code to open the Extension Development Host.
4. Open any folder containing `.properties` files to test.
5. Run `npm run lint` before submitting a pull request.

---

## License

MIT © 2026 Resource Bundle Studio Contributors
