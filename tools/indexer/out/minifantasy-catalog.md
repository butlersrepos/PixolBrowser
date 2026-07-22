# MiniFantasy Asset Catalog

_Generated 2026-07-22 · 11578 images across 199 packs._

This is the fast lookup surface for the MiniFantasy pixel-art library. Use it to
pick the right **pack** and **tags** before drilling in. The full per-image index
(one JSON object per line: `path, pack, kind, ext, w, h, tags, strip?`) lives at:

    ~/dev/pixel-art/pixel-browser/tools/indexer/out/minifantasy-index.jsonl

**To search it** (examples):
```sh
# every poison spell effect that's an animated strip
grep '"poison"' ~/dev/pixel-art/pixel-browser/tools/indexer/out/minifantasy-index.jsonl | grep '"strip":true' | grep spell-effect
# all druid character sheets, ignoring drop-shadow layers
grep '"druid"' ~/dev/pixel-art/pixel-browser/tools/indexer/out/minifantasy-index.jsonl | grep -v '"excluded":true'
# tilesets in the dungeon environment
grep '"kind":"tileset"' ~/dev/pixel-art/pixel-browser/tools/indexer/out/minifantasy-index.jsonl | grep -i dungeon
```

**Regenerate** after adding packs:
```sh
node ~/dev/pixel-art/pixel-browser/tools/indexer/index-minifantasy.js
```

**Richer descriptive tags** (mossy / ornate / torch-lit …) are an optional
one-time Claude vision pass over one representative image per subject — see
`tools/indexer/vision-pass.js`. Not run by default; the tags below are 100%
deterministic (derived from folder + filename, no AI).

## Kinds
- **creature** — 4510
- **character** — 2937
- **tileset** — 1797
- **spell-effect** — 869
- **misc** — 509
- **ui** — 377
- **weapon** — 250
- **prop** — 246
- **building** — 57
- **vfx** — 22
- **portrait** — 4

## Top tags
`animation`(7253) · `exclusive`(5469) · `creature`(4527) · `character`(3148) · `tileset`(2325) · `race`(2287) · `variant`(2054) · `shadow`(1976) · `npc`(1681) · `environment`(1617) · `idle`(1434) · `damage`(1401) · `death`(1293) · `walk`(1209) · `attack`(1194) · `vfx`(1045) · `spell-effect`(974) · `prop`(924) · `terrain`(714) · `human`(709) · `class`(680) · `crafting`(674) · `town`(628) · `element`(613) · `hero`(492) · `special`(476) · `orc`(474) · `creature-type`(463) · `direction`(444) · `monster`(424) · `dungeon`(420) · `ui`(406) · `undead`(364) · `goblin`(314) · `elf`(298) · `weapon`(271) · `green`(258) · `diagonal`(249) · `dwarf`(243) · `animated`(243)

## Packs
| Pack | images | kinds | top tags |
|------|-------:|-------|----------|
| AMyriadOfNPCs | 1681 | character(1681) | character(1681), npc(1681), animation(1665), variant(1540), damage(417), death(416) |
| Creatures | 494 | creature(494) | creature(494), animation(486), race(262), humanoid(220), shadow(169), monster(133) |
| Magic_Weapons_And_Effects | 485 | spell-effect(485) | spell-effect(485), vfx(485), animation(243), attack(220), element(129), fire(43) |
| _Miscellany | 435 | misc(407) building(11) tileset(9) prop(6) ui(2) | exclusive(435), shadow(75), animation(36), race(35), mockup(29), variant(19) |
| Crafting_And_Professions_I_II | 331 | tileset(261) character(69) ui(1) | crafting(331), exclusive(331), prop(331), tileset(331), race(273), animation(249) |
| Monster_Creatures | 291 | creature(291) | creature(291), monster(291), animation(244), shadow(89), death(59), attack(57) |
| Weapons | 271 | weapon(250) character(21) | weapon(271), race(163), exclusive(98), animation(94), attack(94), charged(73) |
| Snowball_Wars_Revamped | 256 | character(235) misc(12) prop(8) tileset(1) | exclusive(256), character(235), animation(196), throw(79), direction(76), race(72) |
| MagicAndSorcery | 253 | spell-effect(149) character(104) | spell-effect(253), vfx(253), character(104), race(104), element(92), explosion(48) |
| Undead_Creatures | 251 | creature(251) | creature(251), race(251), undead(251), animation(243), zombie(104), animated(100) |
| True_Villains_I | 241 | character(241) | animation(241), character(241), villain(241), special(174), shadow(55), creature-type(28) |
| CraftingAndProfessions2 | 221 | tileset(196) character(25) | crafting(221), prop(221), tileset(221), race(88), animation(78), shadow(44) |
| True_Heroes_II | 176 | character(176) | character(176), hero(176), animation(175), special(103), class(63), paladin(63) |
| True_Heroes_III | 166 | character(166) | character(166), hero(166), animation(165), special(105), shadow(42), direction(36) |
| TrueHeroes | 150 | character(150) | character(150), hero(150), animation(149), class(149), special(94), druid(73) |
| Gnomes | 149 | creature(149) | animation(149), creature(149), exclusive(149), variant(90), attack(32), death(31) |
| Spell_Effects_II | 144 | spell-effect(143) ui(1) | spell-effect(144), vfx(144), arcane(47), element(47), shadow(40), aura(31) |
| UI _Overhaul | 132 | ui(82) misc(50) | ui(82), variant(40), sample(14), shadow(13), cursor(9), blue(8) |
| Towns_I_II | 124 | tileset(124) | environment(124), exclusive(124), tileset(124), town(124), shadow(19), animated(9) |
| CraftingAndProfessions | 122 | tileset(110) character(12) | crafting(122), prop(122), tileset(122), race(42), shadow(27), character(12) |
| Pit_Warriors | 117 | creature(117) | animation(117), creature(117), exclusive(117), throw(33), direction(32), damage(18) |
| Medieval_Carnival | 116 | tileset(116) | environment(116), exclusive(116), tileset(116), town(116), class(113), knight(113) |
| Birds | 103 | creature(103) | creature(103), exclusive(103), animation(64), death(26), damage(25), idle(13) |
| Tree_Spirits | 98 | creature(98) | creature(98), exclusive(98), animation(46), death(13), shadow(12), damage(11) |
| User_Interface | 97 | ui(91) tileset(4) portrait(2) | exclusive(97), ui(97), animated(24), shadow(16), element(4), terrain(4) |
| Modern_Soldiers | 88 | creature(88) | creature(88), exclusive(88), animation(62), direction(26), death(21), damage(17) |
| Ursaling | 82 | creature(82) | creature(82), exclusive(82), animation(81), class(45), warrior(45), death(20) |
| UserInterface | 80 | ui(80) | ui(80), variant(40), sample(13), blue(8), green(8), purple(8) |
| Spell Effects | 78 | spell-effect(78) | element(78), spell-effect(78), vfx(78), tileable(62), ice(24), electric(20) |
| Dungeon | 75 | tileset(39) character(30) prop(6) | dungeon(75), environment(75), tileset(75), exclusive(36), animation(30), character(30) |
| Dwarven_Workshop | 74 | tileset(49) prop(25) | dungeon(74), environment(74), tileset(74), animated(28), prop(25), shadow(15) |
| Raided_Village | 71 | prop(32) tileset(27) character(9) ui(2) building(1) | environment(71), tileset(71), town(71), prop(32), element(25), fire(25) |
| SilentSwamp | 67 | tileset(63) prop(4) | environment(67), terrain(67), tileset(67), animation(46), shadow(19), attack(11) |
| Town_Guards | 60 | creature(60) | animation(60), creature(60), exclusive(60), race(60), shadow(20), dwarf(15) |
| Deep_Caves | 57 | tileset(53) prop(4) | environment(57), exclusive(57), terrain(57), tileset(57), variant(18), shadow(8) |
| Medieval_City | 57 | tileset(36) prop(10) ui(8) building(3) | environment(57), tileset(57), town(57), exclusive(13), guideline(12), ui(12) |
| Astronaut | 54 | creature(54) | creature(54), exclusive(54), animation(32), shadow(14), damage(12), direction(12) |
| Lost_Jungle | 54 | tileset(52) prop(2) | environment(54), terrain(54), tileset(54), animation(48), shadow(17), attack(13) |
| Cultists | 52 | creature(52) | creature(52), exclusive(52), animation(50), green(15), variant(15), attack(10) |
| Spectre | 52 | creature(52) | creature(52), exclusive(52), animation(36), attack(12), death(8), damage(8) |
| Scifi_Space_Derelict | 51 | tileset(46) prop(5) | environment(51), exclusive(51), tileset(51), town(51), terrain(11), shadow(10) |
| CastlesAndStrongholds | 50 | tileset(30) prop(20) | dungeon(50), environment(50), tileset(50), prop(20), shadow(15), terrain(8) |
| Farm | 48 | tileset(48) | environment(48), exclusive(48), tileset(48), town(48), race(27), shadow(10) |
| 8x8px | 48 | ui(48) | exclusive(48), icon(48), ui(48), sample(3), guideline(1), class(1) |
| Ancient_Forests | 46 | tileset(40) prop(6) | environment(46), terrain(46), tileset(46), variant(14), green(12), shadow(12) |
| Orc_Shaman | 46 | creature(46) | character(46), class(46), creature(46), exclusive(46), orc(46), race(46) |
| Mountain_Stronghold | 44 | tileset(31) prop(13) | dungeon(44), environment(44), tileset(44), prop(13), animated(9), shadow(6) |
| Plants_&_Foliage | 44 | tileset(44) | environment(44), terrain(44), tileset(44), mockup(14), shadow(5), green(3) |
| Goblin_Raider | 43 | creature(43) | creature(43), exclusive(43), goblin(43), race(43), animation(38), shadow(12) |
| Shoggoth's_Avatar | 43 | creature(43) | creature(43), exclusive(43), animation(38), attack(21), shadow(13), damage(12) |
| Pharaoh_Tomb | 42 | tileset(33) prop(9) | dungeon(42), environment(42), tileset(42), green(10), variant(10), shadow(9) |
| Towns | 42 | tileset(31) building(9) prop(2) | environment(42), tileset(42), town(42), terrain(20), shadow(14), building(9) |
| Towns2 | 42 | building(19) tileset(15) prop(8) | environment(42), tileset(42), town(42), building(19), shadow(15), terrain(12) |
| The_King_In_Yellow | 41 | creature(26) ui(15) | boss(41), creature(41), eldritch(41), exclusive(41), variant(41), yellow(41) |
| War_Servitor | 41 | creature(41) | creature(41), exclusive(41), guardian(41), animation(22), direction(12), vfx(8) |
| Lizardmen | 40 | creature(40) | animation(40), creature(40), exclusive(40), shadow(10), attack(8), death(8) |
| Gnome_Gyrocopter | 39 | creature(39) | creature(39), exclusive(39), shadow(13), animation(12), death(6), damage(6) |
| Swamp_Witch | 38 | creature(38) | creature(38), exclusive(38), animation(27), shadow(13), green(12), variant(12) |
| Summer_Holidays | 38 | character(18) tileset(13) prop(6) misc(1) | exclusive(38), character(18), human(18), race(18), animation(15), terrain(13) |
| Mounts | 36 | creature(36) | creature(36), creature-type(36), dragon(36), exclusive(36), mount(36), race(36) |
| Chimera | 36 | creature(36) | animation(36), creature(36), exclusive(36), attack(12), shadow(12), death(6) |
| PileOfFlesh | 36 | creature(36) | creature(36), exclusive(36), animation(29), shadow(11), death(10), damage(6) |
| Mimic February 2021  (King Skeleton And Ancient Troll) | 36 | creature(36) | boss(36), creature(36), creature-type(36), mimic(36), race(36), skeleton(36) |
| Temples_And_Shrines | 34 | prop(19) tileset(15) | dungeon(34), environment(34), tileset(34), prop(19), animated(15), element(10) |
| Ancient_Danger | 33 | creature(33) | creature(33), environment(33), exclusive(33), terrain(33), tileset(33), animation(24) |
| Frogfolk | 33 | creature(33) | animation(33), creature(33), exclusive(33), class(18), warrior(18), shadow(11) |
| Supreme_Elemental | 33 | creature(33) | animation(33), creature(33), exclusive(33), summon(17), shadow(10), attack(4) |
| Ancient_Danger_Heavy_Warrior | 32 | creature(32) | character(32), class(32), creature(32), exclusive(32), warrior(32), animation(20) |
| Ferryman_Of_The_Dead | 32 | creature(32) | creature(32), exclusive(32), animation(21), idle(9), shadow(6), attack(3) |
| Travelling_Merchant | 32 | creature(32) | creature(32), exclusive(32), animation(23), idle(11), shadow(10), attack(3) |
| _+129 smaller packs_ | 2474 | _(grep the JSONL by pack)_ | |
