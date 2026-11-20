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

test('bridge and MCP paths resolve under HOME and DEEPTUTOR_HOME', () => {
  const env = { HOME: '/home/test', DEEPTUTOR_HOME: '/srv/deeptutor' };
  assert.equal(mcpBridgePath(env), path.join('/home/test', '.config/magpie/deeptutor-mcp-bridge.json'));
  assert.equal(mcpConfigPath(env), path.join('/srv/deeptutor', 'data/user/settings/mcp.json'));
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
