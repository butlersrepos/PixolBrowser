# MiniFantasy indexer

Turns the `~/dev/pixel-art/MiniFantasy` asset trove (~11.5k images across ~200
packs) into a searchable index, so both a coding agent and PixolBrowser can
narrow "find me a poison AoE effect" down to a handful of candidates instead of
`find`-ing 9,000 paths and eyeballing.

Zero dependencies. Reads image dimensions from file headers (same byte-parsing
as PixolBrowser's `main.js`). All tags are **deterministic** — derived from the
folder path + filename, no AI. One taxonomy (`taxonomy.js`) drives every output.

## Run

```sh
node index-minifantasy.js            # defaults: assets = ~/dev/pixel-art/MiniFantasy
node index-minifantasy.js <assetsRoot> <outDir>
```

Re-run any time you add packs. It's fast (a few seconds) and idempotent.

## Outputs (`out/`)

| File | For | What |
|------|-----|------|
| `minifantasy-index.jsonl` | the agent | one JSON object per image: `path, pack, kind, ext, w, h, tags[], strip?, excluded?`. Grep it. |
| `MiniFantasy.pixol-browser.json` | PixolBrowser | `autoTagRules` + `excludePatterns`. Also written as a **sidecar** into the assets root, so opening that folder in the app offers to import it. |
| `minifantasy-catalog.md` | both | pack-by-pack + tag-count summary; the "which pack?" lookup surface. Copied to `~/docs/knowledge/minifantasy-asset-catalog.md`. |

## Searching the index

```sh
IDX=out/minifantasy-index.jsonl
grep '"poison"' $IDX | grep '"kind":"spell-effect"' | grep '"strip":true'   # poison effect strips
grep '"druid"' $IDX | grep -v '"excluded":true'                              # druid sheets, no drop-shadows
grep '"kind":"tileset"' $IDX | grep -i dungeon                               # dungeon tilesets
```

Field notes:
- **`kind`** — one of character, creature, tileset, spell-effect, weapon, prop,
  ui, building, vfx, portrait, misc.
- **`tags`** — facets: animation state (idle/walk/attack/…), element
  (fire/ice/poison/…), race/class/creature-type, color/material `variant`,
  direction, plus structural (`animation`, `shadow`, `mockup`).
- **`strip: true`** — one image dimension is an integer multiple (≥2×) of the
  other, i.e. it's probably a multi-frame sprite sheet, not a single icon.
- **`excluded: true`** — drop-shadow layers, mockups, samples, guidelines. Noise
  you almost always want to filter out. (Excluded-by-default in the app too.)
- **`exclusive`** tag — lives under the `All_Exclusives` mega-bundle, which
  partially overlaps the standalone packs. Filter it in or out as needed.

## Editing the taxonomy

Everything lives in `taxonomy.js`:
- `PACK_RULES` — a pack's default kind/tags from its folder name.
- `PATH_RULES` — structural folders (`/Tileset/`, `/Props/`, `/Shadows/`); glob-matched.
- `TOKEN_RULES` — filename **words**, split on separators AND CamelCase
  (`ChargedAttack` → `charged`, `attack`; `No_Torch` → `no`, `torch`, so `orc`
  never matches "Torch"). This word matching is why the index is precise.
- `FLAG_RULES` — the noise categories excluded by default.

The app config can only do substring globs (no CamelCase boundaries), so
`tokenAppGlobs()` approximates each word rule per facet. The JSONL is the exact
artifact; the app rules are the editable convenience layer.

## Optional: descriptive vision tags

`vision-pass.js` adds tags the filenames never contain (mossy, gothic, torch-lit,
warm palette…) by having Claude look at the pixels. It's cost-controlled: it
tags **one representative per asset group** (~2,500 images, not all 11.5k),
because a character's idle/walk/attack look identical to a descriptive tagger.

```sh
node vision-pass.js            # DRY RUN — picks representatives, prints cost
node vision-pass.js --run      # calls the API (needs ANTHROPIC_API_KEY)
node vision-pass.js --run --limit 50    # cheap trial first
```

- One-time cost: ~$3 on Sonnet, ~$1.55 on Haiku (halve with the Batch API).
- Runs on the **Anthropic API** (pay-per-token), which is a separate meter from a
  Claude Max subscription — it does not draw on it.
- Writes `out/vision-tags.json` (per group) and
  `out/minifantasy-index.enriched.jsonl` (base fields + a `desc[]` array). The
  base index is left untouched. Resumable — re-running skips tagged groups.
