const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { macAppPath, asepriteLocations, resolveExternalEditor, openExternalFile } = require('../external-editor');

test('macOS running executable resolves to its own app bundle', () => {
  const steam = '/Users/example/Library/Application Support/Steam/steamapps/common/Aseprite/Aseprite.app';
  assert.equal(macAppPath(`${steam}/Contents/MacOS/aseprite`), steam);
  assert.equal(macAppPath(`${steam}/Contents/MacOS/aseprite --some-option`), steam);
  assert.equal(macAppPath('/usr/bin/aseprite'), null);
});

test('common install locations cover macOS, Windows, and Linux', () => {
  assert.ok(asepriteLocations('darwin').some(location => location.includes('Steam/steamapps/common/Aseprite/Aseprite.app')));
  assert.ok(asepriteLocations('win32').some(location => location.endsWith(path.join('Aseprite', 'aseprite.exe'))));
  assert.ok(asepriteLocations('linux').includes('/usr/bin/aseprite'));
});

test('chosen program takes priority over automatic Aseprite detection', async () => {
  assert.deepEqual(await resolveExternalEditor('/Applications/Other Editor.app'), {
    name: 'Other Editor', path: '/Applications/Other Editor.app', source: 'chosen',
  });
});

test('missing image reports an error before opening another program', async () => {
  await assert.rejects(openExternalFile('/no/such/image.png', { path: null }, {
    openPath() { throw Error('must not be called'); },
  }), /Image file was not found/);
});
