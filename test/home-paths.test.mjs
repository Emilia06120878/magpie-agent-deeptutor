import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { catalogOf, desktopWorkspace } from '../lib/home-paths.mjs';

test('Windows desktop workspace comes from LOCALAPPDATA, not an install path', () => {
  const local = path.join(path.sep, 'Users', 'someone', 'AppData', 'Local');
  assert.equal(
    desktopWorkspace('win32', { LOCALAPPDATA: local }, path.sep),
    path.join(local, 'Open DeepTutor', 'workspace'),
  );
  assert.equal(desktopWorkspace('win32', {}, path.sep), null);
});

test('macOS desktop workspace comes from the current user home', () => {
  const home = path.join(path.sep, 'Users', 'someone');
  assert.equal(
    desktopWorkspace('darwin', {}, home),
    path.join(home, 'Library', 'Application Support', 'Open DeepTutor', 'workspace'),
  );
});

test('unsupported desktop platforms and catalog paths stay predictable', () => {
  assert.equal(desktopWorkspace('linux', {}, '/home/someone'), null);
  assert.equal(
    catalogOf(path.join(path.sep, 'workspace')),
    path.join(path.sep, 'workspace', 'data', 'user', 'settings', 'model_catalog.json'),
  );
});
