# PixolBrowser Roadmap

Status legend: `[ ]` todo | `[x]` done | `[~]` in progress

See `PROJECT_CONTEXT.md` for architecture, current features, and onboarding context.

---

## Recently Completed

- [x] **Keyboard gallery navigation** — arrow keys move selection through grid, Shift+Arrow for range extend
- [x] **Copy file path** — button in detail panel and carousel to copy absolute path to clipboard
- [x] **Transparency checker background** — toggle between dark, checkerboard, white, or custom color in detail panel and carousel

---

## Batch 1: Quick Wins

Independent features, any order. Immediate daily-use value.

- [x] **1. Recent Directories** — "Recent Folders" dropdown in Open Folder flow. Persist last 5-10 opened directories. One click reopens without the directory picker.
  - Touches: `main.js`, `renderer/app.js` (open-folder modal)

- [x] **2. Reveal in Finder/Explorer** — "Show in Finder" button in detail panel and carousel. Electron: `shell.showItemInFolder()`. Web: copy full path.
  - Touches: `main.js` (IPC), `preload.js`, `renderer/app.js`

- [x] **3. Recently Viewed Images** — Track last 20 selected/inspected images. Collapsible sidebar section or dropdown. Persisted across sessions. Click to jump.
  - Touches: `renderer/app.js`, metadata persistence

- [x] **4. Fuzzy Quick-Open Overlay** — `Cmd+P`/`Ctrl+P` floating search. Fuzzy-match filenames with tiny thumbnails in results. Enter selects and scrolls to image. Escape dismisses.
  - Touches: `renderer/app.js`, `renderer/styles.css`

---

## Batch 2: Sprite Sheet Workbench

Highest excitement features. Sequential dependencies within batch.

- [x] **5. Frame Grid Configurator** — In carousel, inputs for columns/rows. Semi-transparent grid overlay on image. Handle padding/gaps. Store grid config per image in metadata. Similar to Godot's sprite sheet editor.
  - Touches: `renderer/app.js`

- [x] **6. Animation Playback with FPS Control** — Play/Pause button + FPS slider (1-30 fps, default 12). Animate frames sequentially. Frame counter. Loop toggle.
  - Depends on: #5
  - Touches: `renderer/app.js`

- [x] **7. Single Frame Isolation** — Click grid cell to isolate frame full-size. Frame index display. Arrow key navigation between frames. Back button to full sheet.
  - Depends on: #5
  - Touches: `renderer/app.js`

- [x] **8. Export Single Frame as PNG** — "Export Frame" button in isolation view. Canvas crop to clipboard or save as `originalname_frame_03.png`. Canvas toBlob + Electron save dialog.
  - Depends on: #7
  - Touches: `renderer/app.js`, `main.js` (save-file IPC)

- [ ] **9. Auto-Grid Detection (experimental)** — "Detect Grid" button. Analyze sprite sheet for consistent transparent/solid columns/rows. Pre-fill column/row values. Jumpstart for manual config, doesn't need to be perfect.
  - Depends on: #5
  - Touches: `renderer/app.js`

---

## Batch 3: Search Power Tools

High daily-use value for short-burst sessions.

- [ ] **10. Omni Search with Prefix Modifiers** — Datadog-style syntax in existing search bar. Default: path match. `t:tagname` tag filter, `s:small` or `s:32-64` dimensions, `d:recent` date, `f:png` file type. Combine freely: `knight t:character s:small`. Autocomplete after prefixes.
  - Touches: `renderer/app.js`

- [ ] **11. Search History** — Last 15 queries. Arrow-down in empty bar shows history dropdown. Click to restore. Clear option.
  - Touches: `renderer/app.js`, metadata

- [ ] **12. Saved Searches** — "Save Current View" captures full filter state (query + tag + dimension + sort). Named saved searches in sidebar. One click restores. Edit/delete.
  - Touches: `renderer/app.js`, metadata

---

## Batch 4: Region Selection & Tile Tools

Innovative differentiator. Sequential dependencies.

- [ ] **13. Region Select Tool** — "Select Region" mode in carousel. Drag rectangle, snaps to pixel boundaries. Shows dimensions. Resize handles. Store per image in metadata.
  - Touches: `renderer/app.js`

- [ ] **14. Tiled Preview Panel** — After selecting region, "Tile Preview" button. Side panel repeats region in configurable NxN grid (3x3, 5x5). Reveals seams and tile connections.
  - Depends on: #13
  - Touches: `renderer/app.js`

- [ ] **15. Region Copy/Export** — Copy or save selected region as PNG. Full workflow: browse tileset, select tile, preview tiled, export.
  - Depends on: #13
  - Touches: `renderer/app.js`

---

## Batch 5: Project & Export Architecture

Foundational refactor. Sequential dependencies.

- [ ] **16. Content-Hash Identity for Metadata** — Compute xxHash of full file contents during scan (~120ms for 60k files). Key metadata by hash, path as secondary index. Reconcile moved/renamed files on rescan. Migrate existing path-keyed metadata.
  - Touches: `main.js`, `renderer/app.js`
  - Note: May add xxhash dependency or use pure-JS implementation

- [ ] **17. Project Profiles (Config Refactor)** — Rename Configs to Project Profiles. Split into shared Tag Library (rules, tags, excludes) + per-profile settings (export folders, prefs). Auto-tag rules gain `scope` field: `"universal"` (default) or array of profile names. Sidebar shows universal + active profile tags only.
  - Touches: `renderer/app.js`, metadata schema migration

- [ ] **18. Export Destinations per Profile** — Each profile stores 1-3 export folders. Configure in Settings > Project Profile. "Copy to Project" button copies file to active profile's export folder.
  - Depends on: #17
  - Touches: `renderer/app.js`, `main.js` (file copy IPC)

- [ ] **19. Direct Copy-to-Project Button** — Prominent "Send to Project" alongside existing "Copy File" in detail panel and carousel. One click if destinations configured, prompts to set up if not. Clipboard copy stays as-is.
  - Depends on: #18
  - Touches: `renderer/app.js`

- [ ] **20. Tag-Based Export** — Right-click tag > "Export All Tagged Files." Copy to destination or active profile export folder. Flatten or preserve structure. Progress indicator.
  - Touches: `renderer/app.js`, `main.js` (batch file copy IPC)

---

## Batch 6: Organization & Ergonomics

- [ ] **21. Nested/Hierarchical Tags** — `/` separator: `Characters/Paladin`, `Tiles/Ground`. Sidebar renders as collapsible groups (Gmail style). Parent tag filter includes children.
  - Touches: `renderer/app.js`

- [ ] **22. Asset Shopping Cart** — Toolbar icon with badge count. Add to cart while browsing. Cart panel with remove. "Export Cart" batch copies to profile export folder. Persists during session.
  - Touches: `renderer/app.js`

- [ ] **23. Drag-and-Drop Out** — Drag images from gallery into Finder/Godot/Unity. Electron `startDrag` API. Web: not supported (tooltip explaining).
  - Touches: `main.js`, `renderer/app.js`

---

## Batch 7: Polish & Delight

- [ ] **24. Animation Preview in Gallery Cells** — For images with saved grid config, show play icon on thumbnail. On hover, animate frames at low FPS (6-8). Adds life to gallery.
  - Depends on: #5
  - Touches: `renderer/app.js`

- [ ] **25. Inline Carousel (Detail Panel Context Switch)** — Carousel becomes inline: gallery narrowed on left, carousel on right where detail panel was. Metadata/tags/export below carousel image. Major layout refactor.
  - Touches: `renderer/app.js`, `renderer/styles.css`

- [ ] **26. Sprite Sheet Auto-Detection Indicator** — Flag images where width is exact multiple of height (common ratios). Subtle badge on gallery thumbnails. Visual hint, not guarantee.
  - Touches: `renderer/app.js`

---

## Batch 8: Differentiator Features

High-impact, higher complexity. These are where PixolBrowser differentiates from Aseprite — simpler UI for workflows game devs repeat.

- [ ] **27. Palette Swap Preview** — Extract unique color palette from sprite. Display as swatches. Select target palette (presets or custom). Real-time recolor preview. Export recolored PNG.
  - Touches: `renderer/app.js`

- [ ] **28. Sprite Sheet Composition** — Select isolated frames from different sheets. Arrange on canvas. Set frame size, rows/columns, spacing. Export as new PNG. Primary use case: cherry-pick frames from related sheets to build custom animations.
  - Depends on: #7
  - Touches: `renderer/app.js`

---

## Batch 9: Future Horizon

Explore when core is solid.

- [ ] **29. Browse Game Project for Asset Audit** — Open game project folder, cross-reference with asset library by filename/hash. Identify duplicates, already-used assets. Hygiene and discovery tool.

- [ ] **30. Shareable Web Galleries** — Export curated subset as standalone static HTML gallery. Share link with collaborators. Hosting challenge: images must be embedded or uploaded.

- [ ] **31. Image Annotations** — Draw circles, arrows, text on assets without modifying files. Stored in metadata by content hash. Requires #16 first.

---

## Previously Considered (Parked)

These were on the old roadmap but have been superseded or deprioritized:

- **Duplicate detection** — Partially addressed by #16 (content-hash) and #29 (asset audit)
- **Star/Favorite rating** — Replaced by tag-based organization and shopping cart (#22)
- **Per-image notes** — Replaced by annotations (#31) which are more visual and spatial
- **Side-by-side compare** — May revisit; lower priority than sprite workbench features
- **Batch rename** — Low demand relative to other features
- **Pin images** — Replaced by shopping cart (#22)
- **Batch tag from CSV** — Low demand relative to omni search and saved searches
- **Grid overlay in carousel** — Subsumed by frame grid configurator (#5)
- **Color palette extraction** — Subsumed by palette swap preview (#27)

---

## Key Dependencies

```
#5 Grid Configurator
 |-> #6 Animation Playback
 |-> #7 Frame Isolation -> #8 Export Frame -> #28 Sheet Composition
 |-> #9 Auto-Grid Detection
 |-> #24 Animation in Gallery

#13 Region Select
 |-> #14 Tiled Preview
 |-> #15 Region Export

#16 Content-Hash Identity
 |-> #17 Project Profiles -> #18 Export Destinations -> #19 Copy-to-Project
 |-> #31 Annotations

#10 Omni Search
 |-> #11 Search History
 |-> #12 Saved Searches

Batch 1 items are fully independent.
```
