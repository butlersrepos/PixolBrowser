# PixolBrowser — Project Context

## What This Is

A desktop (Electron) and web image collection curator built for browsing, tagging, and searching large pixel art and sprite sheet collections. The primary pain point: 60k+ image assets spread across deeply nested folders with no efficient way to browse, compare, or organize them. This app flattens the folder structure into a searchable, taggable gallery.

**The app's differentiation:** Bring common sprite artist workflows (animation preview, frame export, palette swap, tile preview) into a simpler, more ergonomic UI than full editors like Aseprite. Not competing on power — competing on speed and simplicity for the workflows game devs actually repeat.

**Core user workflow:** Intense short sessions to search/discover an asset, inspect/evaluate it (including sprite sheet animation), then transplant it into a game dev project.

**Repo**: https://github.com/butlersrepos/PixolBrowser
**Live web version**: https://butlersrepos.github.io/PixolBrowser/

## Architecture

- **Electron desktop app** — vanilla HTML/CSS/JS, no framework
- **Web version** in `docs/` served by GitHub Pages, uses File System Access API + localStorage as a shim for Electron's IPC/Node APIs
- Both versions are maintained as a single application — `docs/web-shim.js` provides `window.api` using browser APIs in place of Electron's IPC/Node
- **~4,500 lines** across 6 source files
- **2 runtime dependencies**: `minimatch` (glob matching for rules)
- **CI/CD**: GitHub Actions builds desktop releases on version tags (mac/win/linux), auto-deploys web version on push

### Key Files

| File | Purpose |
|------|---------|
| `main.js` | Electron main process: window, IPC handlers, file scanning, dimension parsing |
| `preload.js` | Context bridge exposing `window.api` to renderer |
| `renderer/app.js` | All UI logic: virtual grid, carousel, zoom/pan, tagging, filtering, theming, settings |
| `renderer/styles.css` | Full CSS with theme variables |
| `renderer/index.html` | App shell with all modals |
| `docs/web-shim.js` | Browser shim replacing Electron APIs with File System Access API + localStorage |

### Data Flow

- Metadata stored in Electron's `userData` directory (`~/Library/Application Support/pixol-browser/metadata.json`)
- Web version uses localStorage
- Metadata contains: active config name, theme, saved themes, carousel bg preferences, last directory
- Configs (rules, tags, excludes) stored under `metadata.configs["ConfigName"]`
- All rule/tag access goes through `activeConfig()` accessor function
- Image dimensions/fileSize/modified read from file headers during scan (raw buffer parsing, no deps)
- Pre-lowercased path index and compiled regex cache for search/filter performance
- Virtual scrolling grid only renders visible cells (~100 at a time)

## Current Features

### Gallery & Browsing
- Open Folder modal with recursive toggle and image count preview before loading
- Supports PNG, JPEG, GIF, WebP, BMP
- Virtual-scrolling grid handles 60k+ images (only renders visible rows)
- Cell labels show 2 parent folders for context (e.g., `Paladin/Shadows/attack.png`)
- Click to select, Cmd+Click toggle, Shift+Click range, Cmd+A select all
- Click to deselect, click empty space to deselect all
- Drag-to-select rubber band selection
- Image count badge floating in gallery top-right
- Keyboard navigation: arrow keys move selection through grid, Shift+Arrow for range extend

### Filtering & Sorting
- Search bar with debounce (150ms) and clear button
- Dimension filter bar with presets (Tiny <=32, Small 33-64, Med 65-128, Lg 129-256, XL 257+)
- Custom min/max dimension range (Enter to apply)
- Sort by Name, File Size, Dimensions, Date Modified with asc/desc toggle
- Tag sidebar filtering (All, Untagged, or specific tag)

### Tagging
- Manual tags on single or multi-selected images
- Tag autocomplete from existing tags
- Auto-tag rules with glob patterns and live match preview (debounced, shows file count + expandable file list)
- Exclude patterns to hide files from gallery
- Right-click tag in sidebar for "Remove from All" with confirmation
- Multi-select tag removal with confirmation dialog

### Detail Panel (always visible, right side)
- Single select: image preview with click-to-center zoom, scroll wheel zoom (8% multiplicative steps), drag to pan, reset button
- Multi select: shows count, shared/partial tag indicators
- File metadata (dimensions, size)
- Copy filename and copy file path buttons
- Exclude button with confirmation
- Transparency checker background: toggle between dark, checkerboard, white, or custom color

### Carousel (Inspect Mode)
- Double-click or Enter to open, Escape or click backdrop to close
- Inspect button in left panel with selection count badge
- Full zoom/pan controls (same as detail panel)
- Left/Right arrow navigation with wrapping (hidden for single image)
- Per-image zoom/pan memory during session (persisted while carousel open, cleared on close)
- Copy File button (copies actual file to macOS clipboard via osascript)
- Copy file path button
- Background color picker (persisted per theme)
- Transparency checker background toggle
- Filename and position counter in title bar

### Theme System
- Settings modal with left-nav categories (Theme, Rules & Tags)
- 8 built-in presets: Dark (Default), Light, Game Boy, Pip-Boy, Virtual Boy, C64, SNES RPG, NES
- Color pickers organized by group (Backgrounds, Text, Borders, Accent, Status)
- Live preview — changes apply immediately
- Save/Load/Delete custom themes
- Export/Import themes as JSON
- Copy current theme as JSON
- Selected cell background derived from accent via `color-mix()`

### Config System (Rules & Tags)
- Named configurations storing rules, exclude patterns, and manual tags
- Default config always exists, auto-migrates from old flat metadata
- Switch between configs in Settings > Rules & Tags (gallery reloads)
- Save As clones active config under new name
- Export as `.pixol-browser.json` file
- Import from `.pixol-browser.json` file
- Sidecar detection: opening a folder with a `.pixol-browser.json` prompts to import it

### Infrastructure
- Custom app icon (macOS Dock via `app.dock.setIcon()`)
- External links open in default browser
- Feedback link in bottom-right corner > GitHub issues
- Git pre-commit hook auto-syncs renderer files to `docs/`
- GitHub Actions: desktop builds on version tag, web deploy on push to main

## Packaging & Distribution

electron-builder is already configured in `package.json`. To build:

```bash
npm run dist:mac   # .dmg (universal binary)
npm run dist:win   # .exe installer
npm run dist:linux # .AppImage
```

GitHub Actions builds all three on version tag push (`git tag v1.0.0 && git push --tags`).

### For selling commercially:
- **Code sign** with Apple Developer certificate (macOS)
- **Notarize** for macOS (Apple malware scan)
- **Auto-updates** via electron-updater
- **Distribution**: Gumroad, itch.io, or Mac App Store

### For npx distribution:
- Add `"bin"` entry to `package.json`
- Move `electron` to `dependencies`
- `npm publish` -> users run `npx pixol-browser`

## Web Version Notes

- Lives in `docs/`, deployed via GitHub Pages
- `web-shim.js` provides `window.api` using File System Access API + localStorage
- `toFileUrl()` checks `window._blobUrls` map (populated during scan) before falling back to `file://` URLs
- Chrome/Edge only (requires `showDirectoryPicker`) — compatibility banner shown on unsupported browsers
- Copy File in carousel copies image data to clipboard (not the file itself, browser limitation)
- Pre-commit hook + GitHub Actions workflow keep `docs/` in sync with `renderer/`

## Architecture Decisions (Planned)

### Metadata Resilience (Content-Hash Identity)
All per-image metadata (tags, sprite grid configs, regions, annotations) should be keyed by a content hash (xxHash of full file) with path as secondary index. This prevents data loss when folders are renamed or files are moved. Hash computed alongside existing dimension parsing during scan. See ROADMAP #16.

### Project Profiles (Replaces Config System)
Split current monolithic config into:
- **Tag Library (global/shared):** Auto-tag rules, exclude patterns, manual tags. Set up once, applies everywhere.
- **Project Profiles (per-project):** Export destination folders, pinned saved searches, display preferences.

Auto-tag rules gain an optional `scope` field: defaults to `"universal"`, can be set to one or more Project Profile names. Sidebar shows universal tags + tags scoped to the active profile. Tags from other profiles are invisible.

Creating a new project = name it + set export folders. All classification inherits automatically. See ROADMAP #17.
