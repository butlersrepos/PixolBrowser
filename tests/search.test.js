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
  const cachedOther = ctx.getTagsForImage('/assets/effects/spark.png');
  run(ctx, `activeConfig().tags['/assets/hero.png'] = ['hero']; invalidateTagCache(['/assets/hero.png']);`);
  assert.deepEqual(plain(ctx.getTagsForImage('/assets/hero.png')), ['hero']);
  assert.equal(ctx.getAllTags().get('hero'),1);
  assert.equal(ctx.getTagsForImage('/assets/effects/spark.png'), cachedOther);
  run(ctx, `delete activeConfig().tags['/assets/hero.png']; invalidateTagCache(['/assets/hero.png']);`);
  assert.deepEqual(plain(ctx.getTagsForImage('/assets/hero.png')), []);
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

test('changing sort order does not mutate the cached collection order', () => {
  const ctx = app();
  const original = [...ctx.getVisibleImages()];
  run(ctx, `state.sortBy='size';applyFilters();state.sortBy='name';state.sortDir='asc';applyFilters();`);
  assert.deepEqual([...ctx.getVisibleImages()], original);
  assert.deepEqual([...run(ctx,'state.filteredImages')], original);
});
