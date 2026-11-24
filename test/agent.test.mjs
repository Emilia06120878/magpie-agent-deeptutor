import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { agent } from '../deeptutor.agent.mjs';
import {
  catalogPath,
  deeptutorHome,
  desktopHome,
  expandHome,
  homeLinkPath,
  linkHome,
  mcpBridgePath,
  mcpConfigPath,
} from '../lib/constants.mjs';

test('agent descriptor declares a Claude-format MCP bridge', () => {
  assert.equal(agent.id, 'deeptutor');
  assert.equal(agent.library.mcpFormat, 'claude');
  assert.match(agent.library.mcp, /deeptutor-mcp-bridge\.json$/);
  assert.equal(agent.config, '~/.config/magpie/deeptutor-home/data/user/settings/model_catalog.json');
  assert.equal(agent.model, 'services.llm.active_model_id');
});

test('bridge paths and explicit-home expansion stay user-relative', () => {
  const env = { HOME: '/home/test', DEEPTUTOR_HOME: '/srv/deeptutor' };
  assert.equal(mcpBridgePath(env), path.join('/home/test', '.config/magpie/deeptutor-mcp-bridge.json'));
  assert.equal(mcpConfigPath(env), '', 'a nonexistent workspace must not be created');
  assert.equal(expandHome('$DEEPTUTOR_HOME/data', env), '/srv/deeptutor/data');
  assert.equal(homeLinkPath(env), path.join('/home/test', '.config/magpie/deeptutor-home'));
});

test('desktop data folder per platform', () => {
  assert.equal(desktopHome({ HOME: '/Users/a' }, 'darwin'),
    path.join('/Users/a', 'Library', 'Application Support', 'Open DeepTutor', 'workspace'));
  assert.equal(desktopHome({ LOCALAPPDATA: 'C:/Users/a/AppData/Local' }, 'win32'),
    path.join('C:/Users/a/AppData/Local', 'Open DeepTutor', 'workspace'));
  assert.equal(desktopHome({ HOME: '/home/a' }, 'linux'), '');
});

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptutor-link-'));
  const home = path.join(root, 'home');
  const desktop = desktopHome({ HOME: home }, 'darwin');
  fs.mkdirSync(path.dirname(catalogPath(desktop)), { recursive: true });
  fs.writeFileSync(catalogPath(desktop), '{"services":{"llm":{}}}\n');
  return { root, home, desktop, env: { HOME: home } };
}

test('home: DEEPTUTOR_HOME wins, else the desktop folder once it has a catalog', () => {
  const s = sandbox();
  assert.equal(deeptutorHome(s.env, 'darwin'), s.desktop);
  assert.equal(deeptutorHome({ ...s.env, DEEPTUTOR_HOME: '/srv/x' }, 'darwin'), '/srv/x');
  fs.rmSync(catalogPath(s.desktop));
  assert.equal(deeptutorHome(s.env, 'darwin'), '');
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('linkHome links the desktop home, and Magpie-style writes land in the real catalog', () => {
  const s = sandbox();
  const first = linkHome(s.env, 'darwin');
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(linkHome(s.env, 'darwin').created, false);
  // Writing through the descriptor's config path reaches the desktop catalog.
  const viaLink = expandHome(agent.config, s.env);
  fs.writeFileSync(viaLink, '{"via":"link"}\n');
  assert.equal(fs.readFileSync(catalogPath(s.desktop), 'utf8'), '{"via":"link"}\n');
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('linkHome repoints a stale link without touching the old target', () => {
  const s = sandbox();
  const old = path.join(s.root, 'old-home');
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'keep.txt'), 'keep');
  fs.mkdirSync(path.dirname(homeLinkPath(s.env)), { recursive: true });
  fs.symlinkSync(old, homeLinkPath(s.env), 'junction');
  const result = linkHome(s.env, 'darwin');
  assert.equal(result.created, true);
  assert.equal(fs.realpathSync(homeLinkPath(s.env)), fs.realpathSync(s.desktop));
  assert.equal(fs.readFileSync(path.join(old, 'keep.txt'), 'utf8'), 'keep');
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('linkHome refuses a real folder in the link place, and creates nothing without DeepTutor', () => {
  const s = sandbox();
  fs.mkdirSync(homeLinkPath(s.env), { recursive: true });
  fs.writeFileSync(path.join(homeLinkPath(s.env), 'mine.txt'), 'mine');
  const refused = linkHome(s.env, 'darwin');
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /not a link/);
  assert.equal(fs.readFileSync(path.join(homeLinkPath(s.env), 'mine.txt'), 'utf8'), 'mine');

  const empty = { HOME: path.join(s.root, 'nobody') };
  assert.equal(linkHome(empty, 'darwin').ok, false);
  assert.equal(fs.existsSync(homeLinkPath(empty)), false);
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('linkHome re-checks the link identity immediately before replacement', (t) => {
  const s = sandbox();
  t.after(() => {
    t.mock.restoreAll();
    fs.rmSync(s.root, { recursive: true, force: true });
  });
  assert.equal(linkHome(s.env, 'darwin').ok, true);
  const link = homeLinkPath(s.env);
  const other = path.join(s.root, 'other-workspace');
  fs.mkdirSync(other);
  fs.unlinkSync(link);
  fs.symlinkSync(other, link, 'junction');

  const originalLstat = fs.lstatSync;
  let calls = 0;
  t.mock.method(fs, 'lstatSync', (file) => {
    if (path.resolve(String(file)) === path.resolve(link)) {
      calls += 1;
      if (calls === 2) {
        // Simulate another process replacing the link between inspection and
        // unlink. The real directory and its contents must survive.
        fs.unlinkSync(link);
        fs.mkdirSync(link);
        fs.writeFileSync(path.join(link, 'keep.txt'), 'keep');
      }
    }
    return originalLstat(file);
  });

  const result = linkHome(s.env, 'darwin');
  t.mock.restoreAll();
  assert.equal(result.ok, false);
  assert.match(result.reason, /no longer a link|changed during setup/);
  assert.equal(fs.readFileSync(path.join(link, 'keep.txt'), 'utf8'), 'keep');
});

test('mcpConfigPath uses an existing catalog and never creates a missing home', () => {
  const s = sandbox();
  const env = { ...s.env, DEEPTUTOR_HOME: s.desktop };
  assert.equal(mcpConfigPath(env), path.join(s.desktop, 'data', 'user', 'settings', 'mcp.json'));
  const missing = path.join(s.root, 'missing-home');
  assert.equal(mcpConfigPath({ ...s.env, DEEPTUTOR_HOME: missing }), '');
  assert.equal(fs.existsSync(missing), false);
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('linkHome accepts an existing CLI workspace before its first catalog exists', () => {
  const s = sandbox();
  const cli = path.join(s.root, 'fresh-cli-workspace');
  fs.mkdirSync(cli);
  const env = { ...s.env, DEEPTUTOR_HOME: cli };
  const result = linkHome(env, 'darwin');
  assert.equal(result.ok, true);
  assert.equal(fs.realpathSync(homeLinkPath(env)), fs.realpathSync(cli));
  assert.equal(mcpConfigPath(env), path.join(cli, 'data', 'user', 'settings', 'mcp.json'));
  assert.equal(fs.existsSync(catalogPath(cli)), false, 'linking alone must not create a catalog');
  fs.rmSync(s.root, { recursive: true, force: true });
});

test('linkHome removes only a stale link when the desktop catalog disappears', () => {
  const s = sandbox();
  assert.equal(linkHome(s.env, 'darwin').ok, true);
  const link = homeLinkPath(s.env);
  fs.rmSync(catalogPath(s.desktop));
  const result = linkHome(s.env, 'darwin');
  assert.equal(result.ok, false);
  assert.equal(result.removed, true);
  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.existsSync(s.desktop), true, 'the real workspace must remain');
  fs.rmSync(s.root, { recursive: true, force: true });
});
