// MiniFantasy asset taxonomy — the single source of truth for classification.
//
// Drives all three generator outputs:
//   - minifantasy-index.jsonl        (agent-greppable, per-image)
//   - MiniFantasy.pixol-browser.json (PixolBrowser auto-tag rules + excludes)
//   - minifantasy-catalog.md         (pack + tag summary)
//
// Two matching strategies:
//   PATH_RULES / FLAG_RULES — glob against the whole relative path. Structural
//     signals (folders like /Tileset/, /Props/, /Shadows/). Compiled with the
//     SAME glob engine PixolBrowser uses, and exported verbatim as app rules.
//   TOKEN_RULES — WORD matching. The path is split into words on separators AND
//     CamelCase boundaries ("ChargedAttack" -> charged, attack; "No_Torch" ->
//     no, torch; "Base_Humanoids" -> base, humanoids). A token matches only a
//     whole word. This is what keeps `orc` off "Torch"/"Sorcery" and `human`
//     off "Humanoids" while still catching the CamelCase-glued names that make
//     up most of this library. The JSONL is built from this precise matching;
//     the app config approximates it per-facet (see tokenAppGlobs).

// ---- Glob engine (byte-for-byte the same as PixolBrowser's) -----------------
const _cache = new Map();
function globToRegex(glob) {
  let re = _cache.get(glob);
  if (re) return re;
  const src = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__GS__')
    .replace(/\*/g, '[^/]*')
    .replace(/__GS__/g, '.*')
    .replace(/\?/g, '[^/]');
  re = new RegExp('^' + src + '$', 'i');
  _cache.set(glob, re);
  return re;
}
function matchesGlob(str, glob) { return globToRegex(glob).test(str); }

// ---- Word tokenizer (separators + CamelCase + letter/digit boundaries) ------
function wordSet(relPath) {
  const words = relPath
    // camelCase / PascalCase boundary: aB -> a B
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // acronym boundary: ABc -> A Bc
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // letter<->digit boundary
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  return new Set(words);
}

// ---- Pack name normalization ------------------------------------------------
function packName(seg) {
  let p = seg
    .replace(/\.(zip|rar)$/i, '')
    .replace(/^PatreonExclusive/i, '')
    .replace(/^Minifantasy[_ ]*[-–][_ ]*/i, '')
    .replace(/^Minifantasy[_ ]+/i, '')
    .replace(/_v\.?\d+(\.\d+)*.*$/i, '')
    .replace(/[ _]v\.?\d+(\.\d+)*.*$/i, '')
    .replace(/_Commercial_Version$/i, '')
    .replace(/_\d{6,8}$/, '')
    .replace(/[_]+$/, '')
    .trim();
  return p || seg;
}

// For a relative path, return {pack, extraTags}. All_Exclusives is a nested
// mega-bundle (All_Exclusives/<Category>/<SubPack>/...) — attribute it to the
// sub-pack and flag every file `exclusive` so it's distinguishable from the
// standalone packs it partially overlaps.
function packOf(relPath) {
  const segs = relPath.split('/');
  if (/^All_Exclusives/i.test(segs[0])) {
    const sub = segs[2] || segs[1] || segs[0];
    return { pack: packName(sub), extraTags: ['exclusive'] };
  }
  return { pack: packName(segs[0]), extraTags: [] };
}

// ---- PACK-level rules (lowercased first segment -> default kind + tags) ------
const PACK_RULES = [
  { re: /trueheroes|true_heroes/, kind: 'character', tags: ['character', 'hero'] },
  { re: /mageoutfit/, kind: 'character', tags: ['character', 'hero', 'mage'] },
  { re: /amyriadofnpcs/, kind: 'character', tags: ['character', 'npc'] },
  { re: /outfits/, kind: 'character', tags: ['character', 'outfit'] },
  { re: /true_villains/, kind: 'character', tags: ['character', 'villain'] },
  { re: /builders/, kind: 'character', tags: ['character', 'worker'] },
  { re: /elf_druid/, kind: 'character', tags: ['character', 'druid'] },
  { re: /dwarven_marksman/, kind: 'character', tags: ['character', 'marksman'] },
  { re: /heavy_warrior|armored_warrior/, kind: 'character', tags: ['character', 'warrior'] },
  { re: /orc_shaman/, kind: 'character', tags: ['character', 'shaman'] },
  { re: /space_orc/, kind: 'character', tags: ['character', 'scifi'] },
  { re: /divine_angel/, kind: 'creature', tags: ['creature', 'angel', 'divine'] },
  { re: /divine_god/, kind: 'creature', tags: ['creature', 'god', 'divine'] },
  { re: /divine_guardian|dwarvenstoneguardian|war_servitor|orb_sentiel/, kind: 'creature', tags: ['creature', 'guardian'] },

  { re: /monster_creatures/, kind: 'creature', tags: ['creature', 'monster'] },
  { re: /undead_creatures/, kind: 'creature', tags: ['creature', 'undead'] },
  { re: /_creatures/, kind: 'creature', tags: ['creature'] },
  { re: /enchanted_companions/, kind: 'creature', tags: ['creature', 'companion'] },
  { re: /forest_dwellers/, kind: 'creature', tags: ['creature'] },
  { re: /wildlife/, kind: 'creature', tags: ['creature', 'animal'] },
  { re: /mounts/, kind: 'creature', tags: ['creature', 'mount'] },
  { re: /dragon_hatchling|griffin/, kind: 'creature', tags: ['creature', 'dragon'] },
  { re: /^golem|magma_golem/, kind: 'creature', tags: ['creature', 'golem'] },
  { re: /the_king_in_yellow/, kind: 'creature', tags: ['creature', 'boss', 'eldritch'] },
  { re: /mimic/, kind: 'creature', tags: ['creature', 'boss', 'mimic'] },

  { re: /spell[_ ]effects/, kind: 'spell-effect', tags: ['spell-effect', 'vfx'] },
  { re: /magic_weapons_and_effects|magicandsorcery|super_tier_magic/, kind: 'spell-effect', tags: ['spell-effect', 'vfx'] },
  { re: /magical_bonfires/, kind: 'vfx', tags: ['vfx', 'fire', 'prop'] },
  { re: /weather_effects/, kind: 'vfx', tags: ['vfx', 'weather'] },
  { re: /stargate/, kind: 'vfx', tags: ['vfx', 'portal', 'scifi'] },

  { re: /minifantasy_weapons/, kind: 'weapon', tags: ['weapon'] },

  { re: /userinterface|ui[_ ]overhaul/, kind: 'ui', tags: ['ui'] },
  { re: /shop_ui/, kind: 'ui', tags: ['ui', 'shop'] },
  { re: /portrait_generator/, kind: 'portrait', tags: ['portrait', 'ui'] },

  { re: /ancient_forests|lost_jungle|silentswamp|desolatedesert|icywilderness|deepcaves|gloom_hollows|hellscape|nightmare_realm|warp_lands|volcano|cenote|astronomical_observatory|ancient_danger/, kind: 'tileset', tags: ['tileset', 'terrain', 'environment'] },
  { re: /forgottenplains|tiny_?overworld|maps|pois|plants_?&?_?foliage|plants_and_foliage/, kind: 'tileset', tags: ['tileset', 'terrain', 'environment'] },
  { re: /castlesandstrongholds|mountain_stronghold|dwarvenkingdom|dwarven_workshop|elvenkingdom|orc_kingdom|persian_palace|pharaoh_tomb|temple|temples_and_shrines|wizards_academy|necropolis|crypt|dungeon|sewers|lost_civilization/, kind: 'tileset', tags: ['tileset', 'environment', 'dungeon'] },
  { re: /medieval_city|medieval_carnival|modern_town|modern_apocalypse|wild_west|towns|ships[_ ]and[_ ]docks|shipwreck|raided_village|adventurer|campsite|farm|ruined_stone_house|stone_house|wooden_house|straw|stucco|trains|scifi|spacederelict/, kind: 'tileset', tags: ['tileset', 'environment', 'town'] },
  { re: /crafting_?and_?professions|craftingandprofessions/, kind: 'tileset', tags: ['tileset', 'crafting', 'prop'] },
  { re: /material_piles/, kind: 'prop', tags: ['prop', 'resource'] },
  { re: /spooky_?graveyard/, kind: 'tileset', tags: ['tileset', 'environment', 'graveyard'] },
  { re: /upgradeable_tiny_buildings/, kind: 'building', tags: ['building'] },
  { re: /ancient_statues|forgottenplainsancientstatues/, kind: 'prop', tags: ['prop', 'statue'] },
  { re: /extendedclifftileset/, kind: 'tileset', tags: ['tileset', 'terrain', 'cliff'] },
];
function packRule(seg) {
  const raw = seg.toLowerCase();
  const stripped = raw.replace(/[_ &'.\-]/g, ''); // match `user_interface` to /userinterface/
  for (const r of PACK_RULES) if (r.re.test(raw) || r.re.test(stripped)) return r;
  return null;
}

// ---- PATH rules (structural). Ordered; last matching `kind` wins, so keep -----
// broad CATEGORY folders first and specific structural rules after.
const PATH_RULES = [
  // category folders (catch mega-bundle internals + anything organized this way)
  { glob: '**/creatures/**', tags: ['creature'], kind: 'creature' },
  { glob: '**/monsters/**', tags: ['creature', 'monster'], kind: 'creature' },
  { glob: '**/heroes/**', tags: ['character', 'hero'], kind: 'character' },
  { glob: '**/weapons/**', tags: ['weapon'], kind: 'weapon' },
  { glob: '**/effects/**', tags: ['vfx'], kind: 'vfx' },

  // UI internals
  { glob: '**/cursors/**', tags: ['ui', 'cursor'], kind: 'ui' },
  { glob: '**/icons/**', tags: ['ui', 'icon'], kind: 'ui' },
  { glob: '**/bars/**', tags: ['ui', 'bar'], kind: 'ui' },
  { glob: '**gui**', tags: ['ui'], kind: 'ui' },
  { glob: '**portrait**', tags: ['portrait'], kind: 'portrait' },

  // Spell effects: <Element>/<Form>/...
  { glob: '**/spell_effects/**', tags: ['spell-effect', 'vfx'], kind: 'spell-effect' },
  { glob: '**/tileable_effect/**', tags: ['spell-effect', 'vfx', 'tileable'], kind: 'spell-effect' },
  { glob: '**/burst/**', tags: ['spell-effect', 'vfx', 'burst'], kind: 'spell-effect' },
  { glob: '**/aura/**', tags: ['spell-effect', 'vfx', 'aura'], kind: 'spell-effect' },
  { glob: '**/impact/**', tags: ['spell-effect', 'vfx', 'impact'], kind: 'spell-effect' },
  { glob: '**/projectile*/**', tags: ['spell-effect', 'vfx', 'projectile'], kind: 'spell-effect' },

  // Tilesets & terrain
  { glob: '**/tileset*/**', tags: ['tileset', 'terrain'], kind: 'tileset' },
  { glob: '**tileset**', tags: ['tileset', 'terrain'], kind: 'tileset' },
  { glob: '**/tiles/**', tags: ['tileset', 'terrain'], kind: 'tileset' },
  { glob: '**autotile**', tags: ['tileset', 'terrain', 'autotile'], kind: 'tileset' },

  // Props / objects
  { glob: '**/animated_props/**', tags: ['prop', 'animated'], kind: 'prop' },
  { glob: '**/props/**', tags: ['prop'], kind: 'prop' },
  { glob: '**/furniture/**', tags: ['prop', 'furniture'], kind: 'prop' },
  { glob: '**/decorations/**', tags: ['prop', 'decoration'], kind: 'prop' },

  // Buildings / structures
  { glob: '**/buildings/**', tags: ['building'], kind: 'building' },
  { glob: '**house**', tags: ['building', 'house'], kind: 'building' },

  // Characters within environment / bundle packs
  { glob: '**/characters/**', tags: ['character'], kind: 'character' },
  { glob: '**/npcs/**', tags: ['character', 'npc'], kind: 'character' },
  { glob: '**/base_humanoids/**', tags: ['creature', 'humanoid'], kind: 'creature' },

  // hero animation folders (no kind override)
  { glob: '**/special_animations/**', tags: ['animation', 'special'] },
  { glob: '**/general_animations/**', tags: ['animation'] },
];

// ---- TOKEN rules ({token, tags, facet}). Word-matched. ----------------------
// facet decides how the app config approximates the word match with a glob.
function t(token, facet, ...tags) { return { token, facet, tags: tags.length ? tags : [token] }; }
const TOKEN_RULES = [
  // animation states (facet 'action' -> plain substring globs; distinctive)
  t('idle', 'action', 'idle', 'animation'),
  t('walk', 'action', 'walk', 'animation'),
  t('run', 'action', 'run', 'animation'),
  t('jump', 'action', 'jump', 'animation'),
  t('charged', 'action', 'charged', 'attack', 'animation'),
  t('attack', 'action', 'attack', 'animation'),
  t('dmg', 'action', 'damage', 'animation'),
  t('hurt', 'action', 'damage', 'animation'),
  t('death', 'action', 'death', 'animation'),
  t('die', 'action', 'death', 'animation'),
  t('dodge', 'action', 'dodge', 'animation'),
  t('cast', 'action', 'cast', 'animation'),
  t('special', 'action', 'special', 'animation'),
  t('sleep', 'action', 'sleep', 'animation'),
  t('crawl', 'action', 'crawl', 'animation'),
  t('throw', 'action', 'throw', 'animation'),
  t('root', 'action', 'root', 'animation'),
  t('summon', 'action', 'summon', 'animation'),

  // elements (facet 'element' -> folder + `_suffix` globs)
  t('fire', 'element', 'fire', 'element'),
  t('ice', 'element', 'ice', 'element'),
  t('frost', 'element', 'ice', 'element'),
  t('poison', 'element', 'poison', 'element'),
  t('venom', 'element', 'poison', 'element'),
  t('blight', 'element', 'poison', 'element'),
  t('electric', 'element', 'electric', 'element'),
  t('lightning', 'element', 'electric', 'element'),
  t('holy', 'element', 'holy', 'element'),
  t('divine', 'element', 'divine', 'element'),
  t('arcane', 'element', 'arcane', 'element'),
  t('nature', 'element', 'nature', 'element'),
  t('explosion', 'action', 'explosion', 'vfx'),
  t('nova', 'action', 'nova', 'vfx'),
  t('beam', 'action', 'beam', 'vfx'),
  t('smoke', 'action', 'smoke', 'vfx'),

  // races / creature-types / subjects (facet 'subject' -> folder globs)
  t('human', 'subject', 'human', 'race'),
  t('elf', 'subject', 'elf', 'race'),
  t('orc', 'subject', 'orc', 'race'),
  t('dwarf', 'subject', 'dwarf', 'race'),
  t('goblin', 'subject', 'goblin', 'race'),
  t('halfling', 'subject', 'halfling', 'race'),
  t('undead', 'subject', 'undead', 'race'),
  t('skeleton', 'subject', 'skeleton', 'race'),
  t('zombie', 'subject', 'zombie', 'race'),
  t('dragon', 'subject', 'dragon', 'creature-type'),
  t('spider', 'subject', 'spider', 'creature-type'),
  t('troll', 'subject', 'troll', 'creature-type'),
  t('bear', 'subject', 'bear', 'creature-type'),
  t('gorilla', 'subject', 'gorilla', 'creature-type'),
  t('beholder', 'subject', 'beholder', 'creature-type'),
  t('snake', 'subject', 'snake', 'creature-type'),
  t('wolf', 'subject', 'wolf', 'creature-type'),
  t('demon', 'subject', 'demon', 'creature-type'),
  t('angel', 'subject', 'angel', 'creature-type'),

  // classes / roles (facet 'subject')
  t('mage', 'subject', 'mage', 'class'),
  t('druid', 'subject', 'druid', 'class'),
  t('rogue', 'subject', 'rogue', 'class'),
  t('barbarian', 'subject', 'barbarian', 'class'),
  t('paladin', 'subject', 'paladin', 'class'),
  t('knight', 'subject', 'knight', 'class'),
  t('warrior', 'subject', 'warrior', 'class'),
  t('archer', 'subject', 'archer', 'class'),
  t('marksman', 'subject', 'marksman', 'class'),
  t('shaman', 'subject', 'shaman', 'class'),

  // color / material variants (facet 'variant' -> `_suffix` globs)
  ...['blue', 'red', 'green', 'black', 'white', 'turquoise', 'purple', 'orange',
    'yellow', 'magenta', 'lime', 'grey', 'pink', 'brown', 'blonde',
    'whiteleather', 'brownleather', 'blackleather']
    .map((c) => t(c, 'variant', c, 'variant')),
  t('gray', 'variant', 'grey', 'variant'),

  // direction (facet 'action' — distinctive words)
  t('diagonal', 'action', 'diagonal', 'direction'),
  t('orthogonal', 'action', 'orthogonal', 'direction'),
];

// How the app config (substring globs) approximates each token's word match.
function tokenAppGlobs(rule) {
  const w = rule.token;
  switch (rule.facet) {
    case 'variant': return [`**_${w}**`];                 // filename suffix `_red`
    case 'element': return [`**/${w}/**`, `**_${w}**`];   // folder or `_fire`
    case 'subject': return [`**/${w}/**`];                // race/class folder
    default: return [`**${w}**`];                          // distinctive substring
  }
}

const FLAG_RULES = [
  { glob: '**shadow**', tags: ['shadow'], exclude: true },
  { glob: '**mockup**', tags: ['mockup'], exclude: true },
  { glob: '**sample**', tags: ['sample'], exclude: true },
  { glob: '**guideline**', tags: ['guideline'], exclude: true },
  { glob: '**animated**', tags: ['animated'] },
];

// ---- classify one file ------------------------------------------------------
function classify(relPath) {
  const segs = relPath.split('/');
  const { pack, extraTags } = packOf(relPath);
  const tags = new Set(extraTags);
  let kind = null;

  // For the All_Exclusives bundle, the sub-pack segment carries the identity;
  // try it (then the category) before the bundle root.
  const pkCandidates = /^All_Exclusives/i.test(segs[0])
    ? [segs[2], segs[1], segs[0]]
    : [segs[0]];
  let pr = null;
  for (const c of pkCandidates) { if (c && (pr = packRule(c))) break; }
  if (pr) { pr.tags.forEach((x) => tags.add(x)); if (pr.kind) kind = pr.kind; }

  for (const r of PATH_RULES) {
    if (matchesGlob(relPath, r.glob)) { r.tags.forEach((x) => tags.add(x)); if (r.kind) kind = r.kind; }
  }
  const words = wordSet(relPath);
  for (const r of TOKEN_RULES) {
    if (words.has(r.token)) r.tags.forEach((x) => tags.add(x));
  }
  let excluded = false;
  for (const r of FLAG_RULES) {
    if (matchesGlob(relPath, r.glob)) { r.tags.forEach((x) => tags.add(x)); if (r.exclude) excluded = true; }
  }
  if (!kind) kind = 'misc';
  return { pack, kind, tags: [...tags].sort(), excluded };
}

// Build the PixolBrowser autoTagRules array from all glob-expressible rules.
function appAutoTagRules() {
  const rules = [];
  for (const r of PATH_RULES) rules.push({ pattern: r.glob, tags: r.tags });
  for (const r of TOKEN_RULES) for (const g of tokenAppGlobs(r)) rules.push({ pattern: g, tags: r.tags });
  for (const r of FLAG_RULES) if (!r.exclude) rules.push({ pattern: r.glob, tags: r.tags });
  return rules;
}
function appExcludePatterns() {
  return FLAG_RULES.filter((r) => r.exclude).map((r) => r.glob);
}

module.exports = {
  classify, packName, packOf, packRule, wordSet,
  PACK_RULES, PATH_RULES, TOKEN_RULES, FLAG_RULES,
  appAutoTagRules, appExcludePatterns, tokenAppGlobs,
  globToRegex, matchesGlob,
};
