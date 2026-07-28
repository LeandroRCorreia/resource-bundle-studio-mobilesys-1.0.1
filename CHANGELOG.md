# Changelog

All notable changes to **Resource Bundle Studio** will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.1] - 2026-07-28

### Changed

- Established the internal Mobilesys fork identity.
- Namespaced public commands, settings, views, and custom editor IDs under
  `mobilesys.resourceBundleStudio`.
- Updated serialization defaults to match the Eclipse ResourceBundle Editor
  formatting used by Mobilesys projects.
- Documented that the original extension must not be installed simultaneously.

### Fixed

- Made Java `.properties` escape parsing and serialization idempotent to prevent
  repeated backslash multiplication.
- Preserved comments, Unicode semantics, placeholders, and values containing
  separators during serialization.

The original project history and credits are preserved below.

## [1.0.0] - 2026-07-01

### Added

- Custom grid editor: all locale files displayed side-by-side in one table
- Inline double-click / Enter / F2 cell editing with multi-line textarea support
- Tab / Shift-Tab keyboard navigation between cells
- Red highlight for missing translations, yellow for values identical to reference locale
- Per-locale missing-count badges in column headers
- Statistics bar showing total keys and missing count
- Add Key modal with optional per-locale initial values
- Rename Key — renames the key atomically across all locale files
- Duplicate Key — copies all values to a new key inserted immediately below
- Remove Key(s) — deletes the key from every locale file, with confirmation
- Drag-and-drop row reordering (synced to all locale files)
- Quick filter bar — live-narrows by key name or value text
- "Missing only" toggle — hides fully-translated rows
- Tree view — groups keys by their dot-separated prefix with collapse/expand
- Context-menu on right-click: rename, duplicate, remove, copy from locale, add after
- Keyboard shortcuts: Ctrl+N add, F2 rename, Del remove
- Sort Keys Alphabetically (on-demand and optional auto-sort on save)
- Convert Non-ASCII ↔ \\uXXXX Unicode escapes (on-demand and optional on save)
- Line-wrap on save (configurable column width)
- New Bundle Wizard: creates base + locale files interactively
- Add Locale: generates a new skeleton .properties file from all existing keys
- Export Bundle to CSV (all locales, all keys in one file)
- Import Bundle from CSV
- Find Missing Translations — populates the VS Code Problems panel with warnings
- Find Duplicate Keys — lists duplicates per locale in a Quick Pick
- Resource Bundles sidebar tree view (groups by base name, shows locale children)
- File-system watcher: editor auto-refreshes when files change externally
- Full comment preservation on parse and serialize
- Backslash line-continuation support for multi-line values
- Unicode escape decoding on parse (\\uXXXX → character)
- Configuration options for all major behaviors
