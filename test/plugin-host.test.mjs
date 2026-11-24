import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import plugin from '../index.mjs';

test('plugin host creates the bridge, syncs MCP and records state in a sandbox HOME', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptutor-host-'));
  const home = path.join(root, 'home');
  const deeptutorHome = path.join(root, 'workspace');
  const settings = path.join(deeptutorHome, 'data', 'user', 'settings');
  fs.mkdirSync(settings, { recursive: true });
  const bridgeFile = path.join(home, '.config', 'magpie', 'deeptutor-mcp-bridge.json');
  const mcpFile = path.join(settings, 'mcp.json');
  fs.mkdirSync(path.dirname(bridgeFile), { recursive: true });
  fs.writeFileSync(bridgeFile, JSON.stringify({ mcpServers: {
    web: { type: 'http', url: 'http://127.0.0.1:3425/mcp/magpie/web' },
  } }));
  fs.writeFileSync(mcpFile, JSON.stringify({ servers: { mine: { command: 'mine' } } }));

  const env = { HOME: home, USERPROFILE: home, DEEPTUTOR_HOME: deeptutorHome };
  assert.equal(plugin.id, 'deeptutor-agent');
  assert.equal(typeof plugin.server, 'function');
  const hooks = await plugin.server({}, undefined, env);
  assert.deepEqual(hooks, {});
  const mcp = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
  assert.deepEqual(Object.keys(mcp.servers), ['mine', 'magpie-deeptutor-web']);
  const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'magpie', '.magpie-deeptutor-state.json'), 'utf8'));
  assert.equal(state.lastLoad.mcp.ok, true);
  assert.equal(state.lastLoad.mcp.count, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('plugin host auto-configures a directly installed desktop and records persistence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptutor-host-desktop-'));
  const home = path.join(root, 'home');
  const localAppData = path.join(root, 'Local AppData');
  const deeptutorHome = path.join(localAppData, 'Open DeepTutor', 'workspace');
  const settings = path.join(deeptutorHome, 'data', 'user', 'settings');
  fs.mkdirSync(settings, { recursive: true });
  fs.writeFileSync(path.join(settings, 'model_catalog.json'), '{}\n');
  fs.writeFileSync(path.join(settings, 'mcp.json'), JSON.stringify({ servers: {} }));

  const env = { HOME: home, USERPROFILE: home, LOCALAPPDATA: localAppData };
  let persisted;
  const hooks = await plugin.server({}, undefined, env, {
    platformName: 'win32',
    homeDirectory: home,
    persist: async (workspace) => {
      persisted = workspace;
      return { method: 'test-persistence' };
    },
  });
  assert.deepEqual(hooks, {});
  assert.equal(persisted, deeptutorHome);
  assert.equal(env.DEEPTUTOR_HOME, deeptutorHome);
  assert.ok(fs.existsSync(path.join(settings, 'mcp.json')));
  const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'magpie', '.magpie-deeptutor-state.json'), 'utf8'));
  assert.equal(state.lastLoad.environment.home, deeptutorHome);
  assert.equal(state.lastLoad.environment.source, 'desktop');
  assert.equal(state.lastLoad.environment.persisted, true);
  assert.equal(state.lastLoad.environment.method, 'test-persistence');
  fs.rmSync(root, { recursive: true, force: true });
});
