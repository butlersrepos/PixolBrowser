---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: [ROADMAP.md]
session_topic: 'New features and future direction for PixolBrowser'
session_goals: 'Ordered implementation backlog of self-contained features for atomic commits'
selected_approach: 'AI-Recommended Techniques'
techniques_used: ['Cross-Pollination', 'SCAMPER', 'What If Scenarios']
ideas_generated: 50
session_active: false
workflow_completed: true
---

# PixolBrowser Feature Backlog

**Date:** 2026-03-23
**Branch:** feature/high-priority-trio (push target)

## Product Positioning

PixolBrowser brings common sprite artist workflows into a simpler, more ergonomic UI than full editors like Aseprite. It's not just a viewer — it's the lightweight inspection-to-export bridge between your asset library and your game engine.

**Core user workflow:** Intense short sessions to search/discover an asset, inspect/evaluate it (including animation preview), then transplant it into a game dev project.

## Architecture Decisions

### Metadata Resilience (Content-Hash Identity)
All per-image metadata (tags, sprite grid configs, regions, annotations) should be keyed by a content hash (xxHash of full file) with path as secondary index. This prevents data loss when folders are renamed or files are moved. Hash computed alongside existing dimension parsing during scan.

### Project Profiles (Replaces Config System)
Split current monolithic config into:
- **Tag Library (global/shared):** Auto-tag rules, exclude patterns, manual tags. Set up once, applies everywhere.
- **Project Profiles (per-project):** Export destination folders, pinned saved searches, display preferences.

Auto-tag rules gain an optional `scope` field: defaults to `"universal"`, can be set to one or more Project Profile names. Sidebar shows universal tags + tags scoped to the active profile. Tags from other profiles are invisible.

Creating a new project = name it + set export folders. All classification inherits automatically.

---

## Implementation Backlog

Each feature is a self-contained commit. Ordered by: foundational dependencies first, then value, then complexity. Features within the same batch are independent and can be done in any order.

---

### Batch 1: Quick Wins (independent, low risk, immediate daily-use value)

**1. Recent Directories**
Add a "Recent Folders" dropdown to the Open Folder flow. Persist last 5-10 opened directories in metadata. One click reopens without the directory picker dialog. High value for short-burst sessions where you're returning to the same asset library.
- Touches: `main.js` (persist recent dirs in metadata), `renderer/app.js` (dropdown UI in open-folder modal)

**2. Reveal in Finder/Explorer**
Add "Show in Finder" button to detail panel and carousel. Opens the OS file manager with the file selected.
- Electron: `shell.showItemInFolder(absolutePath)`
- Web: Show the full path with a copy button (no OS integration available)
- Touches: `main.js` (new IPC handler), `preload.js` (expose API), `renderer/app.js` (button in detail panel + carousel)

**3. Recently Viewed Images**
Track last 20 images the user selected or inspected in the carousel. Show as a collapsible section in the sidebar or a quick-access dropdown. Persisted across sessions in metadata. Click to jump to that image in the gallery.
- Touches: `renderer/app.js` (track views, render recent list, scroll-to-image on click), metadata persistence

**4. Fuzzy Quick-Open Overlay**
`Cmd+P` / `Ctrl+P` opens a floating search overlay. Fuzzy-matches against all image filenames in the current collection. Results update as you type with tiny thumbnails alongside names. Enter selects and scrolls to that image in the gallery. Escape dismisses.
- Touches: `renderer/app.js` (overlay UI, fuzzy match algorithm, keyboard shortcut), `renderer/styles.css` (overlay styling)

---

### Batch 2: Sprite Sheet Workbench (highest excitement, sequential)

**5. Frame Grid Configurator**
In the carousel, add inputs for columns and rows. Draw a semi-transparent grid overlay on the image so the user can visually verify frame alignment. Handle edge cases: padding between frames, non-square frames. Store grid config per image in metadata (keyed by path initially, migrate to hash later). Similar to Godot's sprite sheet editor.
- Touches: `renderer/app.js` (grid overlay rendering on carousel canvas, column/row inputs, per-image config storage)

**6. Animation Playback with FPS Control**
Once a grid is configured, add a Play/Pause button and FPS slider (range: 1-30 fps, default 12). Animate through frames sequentially. Show current frame number. Stop on last frame or loop (toggle).
- Depends on: #5 (grid configurator)
- Touches: `renderer/app.js` (animation loop using requestAnimationFrame or setInterval, playback controls UI)

**7. Single Frame Isolation**
Click any cell in the configured grid to isolate that frame. Shows it full-size in the carousel view with its frame index. Navigate between frames with arrow keys while in isolation mode. Back button returns to full sheet view.
- Depends on: #5 (grid configurator)
- Touches: `renderer/app.js` (frame click handler, isolated frame rendering, navigation)

**8. Export Single Frame as PNG**
When viewing an isolated frame, add "Export Frame" button. Renders just that frame to a canvas and either copies to clipboard or saves as a new PNG file (with a sensible default name like `originalname_frame_03.png`). Uses canvas toBlob + Electron's file save dialog.
- Depends on: #7 (frame isolation)
- Touches: `renderer/app.js` (canvas crop + export), `main.js` (save-file IPC handler if saving to disk)

**9. Auto-Grid Detection (experimental)**
Add a "Detect Grid" button alongside the manual column/row inputs. Analyzes the sprite sheet for consistent transparent or solid-color columns/rows to guess frame boundaries. Pre-fills column/row values. Doesn't need to be perfect — it's a jumpstart for manual configuration. Falls back gracefully if detection fails.
- Depends on: #5 (grid configurator, provides the UI to pre-fill)
- Touches: `renderer/app.js` (pixel analysis algorithm, button UI)

---

### Batch 3: Search Power Tools (high daily-use value)

**10. Omni Search with Prefix Modifiers**
Enhance the existing search bar to support Datadog-style prefix modifiers:
- Default: path/filename matching (current behavior)
- `t:tagname` — filter to tag
- `s:small` or `s:32-64` — dimension filter by preset name or range
- `d:recent` or `d:>2026-01` — date modified filter
- `f:png` or `f:gif` — file type filter
- Combine freely: `knight t:character s:small`
- Autocomplete for tag names after `t:` and preset names after `s:`
- Touches: `renderer/app.js` (search parser, autocomplete dropdown, filter integration)

**11. Search History**
Persist last 15 search queries. Arrow-down in an empty search bar shows history as a dropdown. Click to restore that search. Clear history option.
- Touches: `renderer/app.js` (history tracking, dropdown UI), metadata persistence

**12. Saved Searches**
"Save Current View" button that captures the full filter state: search query, tag filter, dimension filter, sort settings. Named saved searches appear in the sidebar. One click restores the complete filter state. Edit/delete saved searches.
- Touches: `renderer/app.js` (capture/restore filter state, sidebar UI, persistence in metadata)

---

### Batch 4: Region Selection & Tile Tools (innovative differentiator)

**13. Region Select Tool**
In the carousel/detail panel, add a "Select Region" mode. User drags a rectangle to define a region within the image. Selection snaps to pixel boundaries. Shows region dimensions. Resize handles on the selection. Store region per image in metadata.
- Touches: `renderer/app.js` (mouse interaction layer on carousel canvas, selection rendering, region storage)

**14. Tiled Preview Panel**
After selecting a region, show a "Tile Preview" button. Opens a side panel or overlay that repeats the selected region in a configurable NxN grid (default 3x3, toggle to 5x5). Reveals seams and how the tile connects/repeats.
- Depends on: #13 (region select)
- Touches: `renderer/app.js` (tile rendering canvas, grid size controls)

**15. Region Copy/Export**
Copy or save just the selected region as a new PNG. Same export flow as single-frame export (#8). Enables the full workflow: browse tileset, find promising tile, preview it tiled, export just that tile.
- Depends on: #13 (region select)
- Touches: `renderer/app.js` (canvas crop from region coordinates, export flow)

---

### Batch 5: Project & Export Architecture (foundational refactor)

**16. Content-Hash Identity for Metadata**
During directory scan, compute xxHash of each file's full contents (fast — ~120ms for 60k files at ~20KB avg). Store metadata keyed by hash with path as secondary index. On subsequent scans, reconcile moved/renamed files: "Found metadata for [hash] at new path [B], previously at [A]." Migrate existing path-keyed metadata on first hash-enabled scan.
- Touches: `main.js` (hash computation during scan, metadata key migration), `renderer/app.js` (metadata access patterns)
- Note: May want to add xxhash as a dependency, or use a pure-JS implementation

**17. Project Profiles (Config Refactor)**
Refactor the existing config system:
- Rename "Configs" to "Project Profiles" in all UI
- Split into: shared Tag Library (rules, tags, excludes) + per-profile settings (export folders, display prefs)
- Auto-tag rules gain optional `scope` field: `"universal"` (default) or array of profile names
- Sidebar shows: universal tags + tags scoped to active profile
- Creating a new profile inherits all shared classification automatically
- Migrate existing configs to new structure seamlessly
- Touches: `renderer/app.js` (settings modal refactor, sidebar tag filtering), metadata schema migration

**18. Export Destinations per Profile**
Each Project Profile stores 1-3 export destination folders. Configure in Settings > Project Profile. "Copy to Project" button in detail panel and carousel copies the file to the active profile's primary export folder. Dropdown for multiple destinations.
- Depends on: #17 (project profiles)
- Touches: `renderer/app.js` (export destination UI in settings, copy-to-project button), `main.js` (file copy IPC handler)

**19. Direct Copy-to-Project Button**
Add prominent "Send to Project" button alongside existing "Copy File" in detail panel and carousel. If a Project Profile with export destinations is active, one click copies the file there. If no destinations configured, prompts to set one up. Keep existing clipboard copy as-is.
- Depends on: #18 (export destinations)
- Touches: `renderer/app.js` (button UI, copy flow)

**20. Tag-Based Export**
Right-click a tag in the sidebar > "Export All Tagged Files." Copies all images with that tag to a chosen destination folder (or active profile's export folder). Option to flatten or preserve folder structure. Progress indicator for large exports.
- Touches: `renderer/app.js` (context menu on tags, export flow), `main.js` (batch file copy IPC handler)

---

### Batch 6: Organization & Ergonomics

**21. Nested/Hierarchical Tags**
Support tags with `/` as hierarchy separator: `Characters/Paladin`, `Tiles/Ground`, `Effects/Fire`. Sidebar renders as collapsible groups (Gmail label style). Auto-tag rules can use hierarchical tag names. Filtering by a parent tag includes all children.
- Touches: `renderer/app.js` (sidebar tag rendering with collapse/expand, tag filtering logic, tag input with `/` support)

**22. Asset Shopping Cart**
Add a "cart" / staging area accessible via a toolbar icon with badge count. While browsing, right-click or button-click to "Add to Cart." Cart panel shows collected assets with remove option. "Export Cart" copies all carted assets to the active profile's export folder. Cart persists during session, clears on explicit action.
- Touches: `renderer/app.js` (cart state, cart panel UI, add-to-cart actions, batch export)

**23. Drag-and-Drop Out**
Enable dragging images from the gallery grid into external applications (Finder, Godot, Unity). Uses Electron's `startDrag` API with the file path and a thumbnail. Web version: not supported (browser limitation), show tooltip explaining.
- Touches: `main.js` (nativeDrag IPC), `renderer/app.js` (dragstart handler on grid cells)

---

### Batch 7: Polish & Delight

**24. Animation Preview in Gallery Cells**
For images with a saved sprite grid config, show a subtle play icon on the gallery thumbnail. On hover (or toggle), animate the frames directly in the grid cell. Low FPS (6-8) to keep it lightweight. Adds life to the gallery when browsing sprite sheets.
- Depends on: #5 (grid configurator provides frame data)
- Touches: `renderer/app.js` (VirtualGrid cell render with animation, hover detection)

**25. Inline Carousel (Detail Panel Context Switch)**
Instead of a popup overlay, the carousel becomes an inline mode: gallery stays visible on the left (narrowed), carousel takes the right side where the detail panel was. Detail panel content (metadata, tags, export buttons) appears below the carousel image. Smoother flow for rapid inspection without losing gallery context.
- Touches: `renderer/app.js` (major UI layout refactor), `renderer/styles.css` (layout modes)

**26. Sprite Sheet Auto-Detection Indicator**
During scan, flag images where width is an exact multiple of height (or vice versa, with common ratios like 2:1, 3:1, 4:1, etc.) as likely sprite sheets. Show a subtle icon/badge on gallery thumbnails. Not a guarantee — just a visual hint to surface candidates.
- Touches: `renderer/app.js` (detection logic during filter, badge rendering on cells)

---

### Batch 8: Differentiator Features (high-impact, higher complexity)

**27. Palette Swap Preview**
Select a sprite in the carousel. Extract its unique color palette (canvas getImageData, deduplicate). Display palette as swatches. User selects a target palette (from presets or custom). Preview the recolor in real time by mapping source colors to target colors. Export the recolored version as a new PNG. Simpler and more ergonomic than Aseprite's palette swap workflow.
- Touches: `renderer/app.js` (palette extraction, color mapping, live preview rendering, export)

**28. Sprite Sheet Composition**
Select multiple individual sprites or isolated frames from different sheets. Arrange them on a canvas to compose a new sprite sheet. Set frame size, arrangement (rows/columns), spacing. Export as a new PNG. Primary use case: cherry-picking frames from related sheets of the same character to build a custom animation. Reverse of frame isolation.
- Depends on: #7 (frame isolation provides the source frames)
- Touches: `renderer/app.js` (composition canvas, frame arrangement UI, export)

---

### Batch 9: Future Horizon (explore when core is solid)

**29. Browse Game Project for Asset Audit**
Open a game project folder and cross-reference with your asset library. Identify: duplicate assets, assets used in project, assets in library not yet in project. Helps with hygiene and discovery. Tags from the library don't carry over (different folder structure), but filename/hash matching works.

**30. Shareable Web Galleries**
Export a curated subset of your library as a standalone static web page. Select a tag or saved search, generate an HTML gallery with embedded images. Share via any static hosting. Collaborators can view without installing the app. Hosting challenge: images must be embedded (base64) or uploaded somewhere.

**31. Image Annotations**
Draw circles, arrows, or text notes on top of an asset without modifying the source file. Annotations stored in metadata (by content hash). Visible in carousel. Useful for notes like "use this row" or "needs recolor." Requires solving metadata resilience first (#16).

---

## Key Dependencies Graph

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

All Batch 1 items are fully independent.
```

## Session Insights

**Strongest user reactions:**
- Sprite Sheet Frame Slicer — audible excitement, validated by Godot comparison
- Export Single Frame — "low-key killer feature" for game dev workflow
- Region Select + Tiled Preview — fills a gap where Aseprite is too heavy
- Palette Swap Preview — "killer feature territory", area to differentiate from Aseprite
- Omni Search with prefix modifiers — Datadog-style, fits power user persona

**Strategic insight:** The app's differentiation is bringing sprite artist workflows (animation preview, frame export, palette swap, tile preview) into a simpler UI than Aseprite. Not competing on power — competing on speed and simplicity for the workflows game devs actually repeat.

**Architectural insight:** Classification (rules, tags) should be universal/shared. Export destinations and project-specific tag scoping belong in per-project profiles. Users shouldn't have to recreate their tagging system for each game project.
