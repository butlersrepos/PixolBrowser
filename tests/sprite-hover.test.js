const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Load the shared renderer without starting the app; these functions have no DOM dependencies.
const context = vm.createContext({ document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(require.resolve('../renderer/app.js'), 'utf8'), context);
const { detectSpriteLayout, validSpriteLayout, spriteFrameRect } = context;
const plain = value => JSON.parse(JSON.stringify(value));

function sheet(width, height, frames) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, w, h] of frames) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) pixels[(py * width + px) * 4 + 3] = 255;
    }
  }
  return () => pixels;
}
function frames(cols, rows, w, h) {
  return Array.from({ length: cols * rows }, (_, i) => [
    (i % cols) * w + 4, Math.floor(i / cols) * h + 4, w - 8, h - 8,
  ]);
}

test('saved grids must produce whole, positive frame dimensions', () => {
  assert.deepEqual(plain(validSpriteLayout(96, 64, { cols: 3, rows: 2 })),
    { cols: 3, rows: 2, frameWidth: 32, frameHeight: 32 });
  for (const config of [{ cols: 0, rows: 2 }, { cols: 5, rows: 2 }, { cols: 1.5, rows: 2 },
    { cols: -1, rows: 2 }, { cols: 192, rows: 2 }, { cols: '3', rows: 2 }]) {
    assert.equal(validSpriteLayout(96, 64, config), null);
  }
});

test('explicit rectangular frame size works without reading pixels', () => {
  const layout = detectSpriteLayout(96, 96, 'hero_walk_32x48.png', () => { throw Error('No pixel read expected'); });
  assert.deepEqual(plain(layout), { cols: 3, rows: 2, frameWidth: 32, frameHeight: 48, source: 'Filename' });
});

test('transparent regular sheets detect horizontal, vertical and rectangular grids', () => {
  for (const [cols, rows, w, h] of [[4, 4, 32, 32], [4, 1, 32, 32], [1, 4, 32, 32], [3, 2, 24, 48]]) {
    const layout = detectSpriteLayout(cols * w, rows * h, 'character.png', sheet(cols * w, rows * h, frames(cols, rows, w, h)));
    assert.deepEqual(plain(layout), { cols, rows, frameWidth: w, frameHeight: h, source: 'Detected' });
  }
});

test('playback traverses each row left to right including trailing blank frames', () => {
  const layout = detectSpriteLayout(96, 64, 'walk.png', sheet(96, 64, frames(3, 2, 32, 32).slice(0, 5)));
  assert.equal(layout.cols * layout.rows, 6);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => plain(spriteFrameRect(layout, i))), [
    [0, 0, 32, 32], [32, 0, 32, 32], [64, 0, 32, 32],
    [0, 32, 32, 32], [32, 32, 32, 32], [64, 32, 32, 32],
  ]);
});

test('static, blank, sparse and explicitly non-animation assets are not sliced', () => {
  assert.equal(detectSpriteLayout(96, 32, 'landscape.png', sheet(96, 32, [[0, 0, 96, 32]])), null);
  assert.equal(detectSpriteLayout(96, 64, 'empty.png', sheet(96, 64, [])), null);
  assert.equal(detectSpriteLayout(96, 96, 'atlas.png', sheet(96, 96, frames(3, 3, 32, 32))), null);
  assert.equal(detectSpriteLayout(96, 96, 'image.png', sheet(96, 96, [[4, 4, 24, 24], [36, 36, 24, 24], [68, 68, 24, 24]])), null);
  assert.equal(detectSpriteLayout(96, 32, 'icons_32x32.png', () => { throw Error('No read'); }), null);
});

test('opaque strips require an animation name; native animation formats stay intact', () => {
  const read = sheet(96, 32, [[0, 0, 96, 32]]);
  assert.equal(detectSpriteLayout(96, 32, 'hero_walk.png', read).cols, 3);
  for (const name of ['hero_walk.gif', 'hero_walk.webp']) {
    assert.equal(detectSpriteLayout(96, 32, name, () => { throw Error('No read'); }), null);
  }
});

test('large unknown sheets do not trigger expensive pixel analysis', () => {
  assert.equal(detectSpriteLayout(4096, 4096, 'image.png', () => { throw Error('No read'); }), null);
});

test('animation hints match words or CamelCase, not fragments of static filenames', () => {
  const read = sheet(96, 32, [[0, 0, 96, 32]]);
  for (const name of ['tree_trunk.png', 'soldier_portrait.png', 'castle.png']) {
    assert.equal(detectSpriteLayout(96, 32, name, read), null);
  }
  assert.equal(detectSpriteLayout(96, 32, 'HeroWalk.png', read).cols, 3);
});
