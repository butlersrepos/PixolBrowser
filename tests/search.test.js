const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function app() {
  const ctx = vm.createContext({ document: { addEventListener() {} } });
  vm.runInContext(fs.readFileSync(require.resolve('../renderer/app.js'), 'utf8'), ctx);
  vm.runInContext(`
    state.baseDirectory = '/assets';
    state.allImages = ['/assets/effects/poison.png', '/assets/effects/spark.png', '/assets/hero.png', '/assets/hidden/poison.png'];
    state.metadata = { activeConfig: 'Default', configs: { Default: {
      tags: { '/assets/effects/poison.png': ['effect'] },
      autoTagRules: [
        { pattern: '**/effects/**', tags: ['effect'] },
        { pattern: '**/*poison*', tags: ['effect', 'poison'] }
      ],
      excludePatterns: ['hidden/**'], excludedFiles: []
    } } };
    state.dimensions = {
      '/assets/effects/poison.png': {width:32,height:32,fileSize:30},
      '/assets/effects/spark.png': {width:64,height:32,fileSize:20},
      '/assets/hero.png': {width:16,height:16,fileSize:10}
    };
  `, ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const plain = value => JSON.parse(JSON.stringify(value));

test('display paths stay within the opened folder and preserve paths outside it', () => {
  const ctx = app();
  assert.equal(run(ctx, `relativePath('/assets/hero.png')`), 'hero.png');
  assert.equal(run(ctx, `relativePath('/assets/effects/frame_2.png')`), 'effects/frame_2.png');
  assert.equal(run(ctx, `relativePath('/assets-other/hero.png')`), '/assets-other/hero.png');
  assert.equal(run(ctx, `relativePath('/elsewhere/hero.png')`), '/elsewhere/hero.png');
  run(ctx, `state.baseDirectory = '/assets/';`);
  assert.equal(run(ctx, `relativePath('/assets/effects/frame_2.png')`), 'effects/frame_2.png');
  run(ctx, `state.baseDirectory = '/sample-sprites';`);
  assert.equal(run(ctx, `relativePath('/sample-sprites/Blue Knight.png')`), 'Blue Knight.png');
});

test('path sort uses relative paths with natural, case-insensitive order in both directions', () => {
  const ctx = app();
  run(ctx, `state.allImages = ['/assets/frame_10.png', '/assets/sub/Frame_2.png', '/assets/frame_2.png', '/assets/Frame_1.png'];
    invalidateVisibleCache(); state.sortBy = 'path'; state.sortDir = 'asc'; applyFilters();`);
  const ascending = plain(run(ctx, 'state.filteredImages'));
  assert.deepEqual(ascending, ['/assets/Frame_1.png', '/assets/frame_2.png', '/assets/frame_10.png', '/assets/sub/Frame_2.png']);
  run(ctx, `state.sortDir = 'desc'; applyFilters();`);
  assert.deepEqual(plain(run(ctx, 'state.filteredImages')), [...ascending].reverse());
});

test('sidebar counts each visible image once per tag across overlapping rules and manual tags', () => {
  const ctx = app();
  assert.deepEqual(plain([...ctx.getAllTags()]), [['effect', 2], ['poison', 1]]);
});

test('warm collection supports text, tag and untagged queries without rematching rules', () => {
  const ctx = app();
  ctx.getAllTags();
  run(ctx, `globMatch = () => { throw Error('Repeated glob matching during search'); }; RegExp.prototype.test = () => { throw Error('Repeated regex matching during search'); };`);
  for (const [query, filter, expected] of [
    ['poison','all',['/assets/effects/poison.png']],
    ['t:poison','all',['/assets/effects/poison.png']],
    ['','untagged',['/assets/hero.png']],
    ['','effect',['/assets/effects/poison.png','/assets/effects/spark.png']]
  ]) {
    ctx.query = query; ctx.filter = filter;
    run(ctx, 'state.searchQuery=query;state.currentFilter=filter;applyFilters();');
    assert.deepEqual(plain(run(ctx,'state.filteredImages')),expected);
    ctx.getAllTags();
  }
});

test('manual-tag edits invalidate affected images and counts without reevaluating other images', () => {
  const ctx = app();
  ctx.getAllTags();
  assert.deepEqual(plain(ctx.getLowercaseTagsForImage('/assets/hero.png')), []);
  const cachedOther = ctx.getTagsForImage('/assets/effects/spark.png');
  run(ctx, `activeConfig().tags['/assets/hero.png'] = ['hero']; invalidateTagCache(['/assets/hero.png']);`);
  assert.deepEqual(plain(ctx.getTagsForImage('/assets/hero.png')), ['hero']);
  assert.deepEqual(plain(ctx.getLowercaseTagsForImage('/assets/hero.png')), ['hero']);
  assert.equal(ctx.getAllTags().get('hero'),1);
  assert.equal(ctx.getTagsForImage('/assets/effects/spark.png'), cachedOther);
  run(ctx, `delete activeConfig().tags['/assets/hero.png']; invalidateTagCache(['/assets/hero.png']);`);
  assert.deepEqual(plain(ctx.getTagsForImage('/assets/hero.png')), []);
  assert.deepEqual(plain(ctx.getLowercaseTagsForImage('/assets/hero.png')), []);
  assert.equal(ctx.getAllTags().has('hero'),false);
});

test('rule edits, excludes, config changes and rescans invalidate collection caches', () => {
  const ctx = app();ctx.getAllTags();
  run(ctx, `activeConfig().autoTagRules = [{pattern:'**/hero.png',tags:['character']}]; invalidateVisibleCache();`);
  assert.deepEqual(plain(ctx.getTagsForImage('/assets/effects/spark.png')), []);
  assert.equal(ctx.getAllTags().get('character'),1);
  run(ctx, `activeConfig().excludedFiles = ['/assets/hero.png']; invalidateVisibleCache();`);
  assert.equal(ctx.getAllTags().has('character'),false);
  run(ctx, `state.metadata.configs.Other = {tags:{},autoTagRules:[],excludePatterns:[],excludedFiles:[]}; state.metadata.activeConfig='Other'; invalidateVisibleCache();`);
  assert.equal(ctx.getAllTags().size,0);
  assert.equal(ctx.getVisibleImages().length,4);
  run(ctx, `state.allImages=['/assets/new.png'];invalidateVisibleCache();`);
  assert.deepEqual(plain(ctx.getVisibleImages()),['/assets/new.png']);
});

test('dimension and format modifiers remain composable with tag and text searches', () => {
  const ctx = app();
  run(ctx, `state.searchQuery='poison t:effect s:32-64 f:png'; applyFilters();`);
  assert.deepEqual(plain(run(ctx,'state.filteredImages')),['/assets/effects/poison.png']);
});

test('plain search words match every term in any order, while quotes keep a phrase', () => {
  const ctx = app();
  run(ctx, `
    state.allImages = [
      '/assets/card_back.png', '/assets/back/card.png',
      '/assets/cards/backs/x.png', '/assets/back card.png',
      '/assets/card.png'
    ];
    activeConfig().tags = { '/assets/card_back.png': ['deck'] };
    activeConfig().autoTagRules = [];
    activeConfig().excludePatterns = [];
    invalidateVisibleCache();
    lowercaseIndex = new Map(state.allImages.map(path => [path, path.toLowerCase()]));
  `);
  for (const [query, expected] of [
    ['back card', ['/assets/card_back.png', '/assets/back/card.png', '/assets/cards/backs/x.png', '/assets/back card.png']],
    ['card back', ['/assets/card_back.png', '/assets/back/card.png', '/assets/cards/backs/x.png', '/assets/back card.png']],
    ['"back card"', ['/assets/back card.png']],
    ['missing card', []],
    ['card', ['/assets/card_back.png', '/assets/back/card.png', '/assets/cards/backs/x.png', '/assets/back card.png', '/assets/card.png']],
    ['back card t:deck', ['/assets/card_back.png']]
  ]) {
    ctx.query = query;
    run(ctx, 'state.searchQuery = query; applyFilters();');
    assert.deepEqual(plain(run(ctx, 'state.filteredImages')), expected, query);
  }
});

test('name filters match cached file names, not folder names, and combine with other terms', () => {
  const ctx = app();
  run(ctx, `
    state.allImages = [
      '/assets/card/hero.png', '/assets/card/back.png',
      '/assets/other/card_back.png', '/assets/other/card back.png'
    ];
    activeConfig().tags = { '/assets/other/card_back.png': ['deck'] };
    activeConfig().autoTagRules = [];
    activeConfig().excludePatterns = [];
    invalidateVisibleCache();
    lowercaseBasenameIndex = new Map(state.allImages.map(path => [path, basename(path).toLowerCase()]));
    basename = () => { throw Error('Rebuilt file name during search'); };
  `);
  for (const [query, expected] of [
    ['name:card', ['/assets/other/card_back.png', '/assets/other/card back.png']],
    ['n:CARD', ['/assets/other/card_back.png', '/assets/other/card back.png']],
    ['name:card n:back', ['/assets/other/card_back.png', '/assets/other/card back.png']],
    ['name:"card back"', ['/assets/other/card back.png']],
    ['n:"card back"', ['/assets/other/card back.png']],
    ['name:hero', ['/assets/card/hero.png']],
    ['other name:card t:deck', ['/assets/other/card_back.png']],
  ]) {
    ctx.query = query;
    run(ctx, 'state.searchQuery = query; applyFilters();');
    assert.deepEqual(plain(run(ctx, 'state.filteredImages')), expected, query);
  }
});

test('every filter has unique aliases and long and short forms parse alike', () => {
  const ctx = app();
  run(ctx, 'Date.now = () => 1700000000000;');
  const aliases = plain(run(ctx, 'SEARCH_FILTERS.flatMap(filter => [filter.long, filter.short])'));
  assert.equal(new Set(aliases).size, aliases.length);
  for (const [long, short, value] of [
    ['name', 'n', 'card'], ['tag', 't', 'effect'], ['size', 's', 'small'],
    ['date', 'd', 'week'], ['type', 'f', 'png'],
  ]) {
    assert.deepEqual(plain(run(ctx, `parseSearchQuery('${long}:${value}')`)),
      plain(run(ctx, `parseSearchQuery('${short}:${value}')`)), long);
  }
});

test('minus excludes words, phrases, tags, file names, and types without changing other syntax', () => {
  const ctx = app();
  run(ctx, `
    state.allImages = [
      '/assets/chest.png', '/assets/chest_mimic.png', '/assets/card/glasses.png',
      '/assets/other/card-back.png', '/assets/other/card back.png', '/assets/chest.gif'
    ];
    activeConfig().tags = { '/assets/chest_mimic.png': ['Boss'] };
    activeConfig().autoTagRules = [];
    activeConfig().excludePatterns = [];
    state.dimensions = Object.fromEntries(state.allImages.map(path => [path, {
      width: path.includes('card back') ? 100 : 32, height: 32,
    }]));
    invalidateVisibleCache();
    lowercaseIndex = new Map(state.allImages.map(path => [path, path.toLowerCase()]));
    lowercaseBasenameIndex = new Map(state.allImages.map(path => [path, basename(path).toLowerCase()]));
  `);
  const all = plain(run(ctx, 'state.allImages'));
  for (const [query, expected] of [
    ['chest -mimic', ['/assets/chest.png', '/assets/chest.gif']],
    ['-mimic', all.filter(path => !path.includes('mimic'))],
    ['-t:boss', all.filter(path => !path.includes('mimic'))],
    ['-tag:boss', all.filter(path => !path.includes('mimic'))],
    ['-n:card', all.filter(path => !path.includes('/other/card'))],
    ['-name:card', all.filter(path => !path.includes('/other/card'))],
    ['-"card back"', all.filter(path => !path.includes('card back'))],
    ['card-back', ['/assets/other/card-back.png']],
    ['s:16-64', all.filter(path => !path.includes('card back'))],
    ['-f:gif', all.filter(path => !path.endsWith('.gif'))],
    ['-type:gif', all.filter(path => !path.endsWith('.gif'))],
    ['-', all],
  ]) {
    ctx.query = query;
    run(ctx, 'state.searchQuery = query; applyFilters();');
    assert.deepEqual(plain(run(ctx, 'state.filteredImages')), expected, query);
  }
  assert.equal(run(ctx, "parseSearchQuery('d:>2026-01-01').dateFilter"), Date.parse('2026-01-01'));
  assert.equal(run(ctx, "parseSearchQuery('-mimic').text"), '');
});

test('changing sort order does not mutate the cached collection order', () => {
  const ctx = app();
  const original = [...ctx.getVisibleImages()];
  run(ctx, `state.sortBy='size';applyFilters();state.sortBy='name';state.sortDir='asc';applyFilters();`);
  assert.deepEqual([...ctx.getVisibleImages()], original);
  assert.deepEqual([...run(ctx,'state.filteredImages')], original);
});
