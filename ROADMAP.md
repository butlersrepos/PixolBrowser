# Roadmap

## Packaging & Distribution

To package as a standalone desktop app for distribution/sale:

1. Install electron-builder: `npm install --save-dev electron-builder`
2. Add a `build` config to `package.json` with app name, icon, targets
3. Build: `npx electron-builder --mac` (or `--win`, `--linux`)
4. Output: `.dmg` (macOS), `.exe` installer (Windows), `.AppImage` (Linux) — ~150-200MB bundled

### For selling commercially:
- **Code sign** with an Apple Developer certificate (macOS) to avoid "unidentified developer" warnings
- **Notarize** for macOS (Apple's malware scan requirement)
- **Auto-updates** via electron-updater for shipping patches
- **Distribution**: Gumroad, itch.io, or Mac App Store (sandboxing adds complexity)

### For npx distribution:
- Pick a package name, add a `"bin"` entry to `package.json`
- Move `electron` from `devDependencies` to `dependencies`
- Publish with `npm publish`
- Users run `npx <package-name>` (Electron ~200MB download on first run, cached after)

## Future Ideas

- App name / branding (candidates: PixelVault, SpriteBox, AssetLens)
- Additional settings categories beyond Theme
- Drag-and-drop images out of the app into other applications
- Thumbnail caching for faster load with large collections
- Image dimension filtering (e.g., show only 16x16, 32x32)
- Sprite sheet slicing preview
- Folder bookmarks (quick-switch between multiple asset directories)
