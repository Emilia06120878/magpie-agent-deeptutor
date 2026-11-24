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
  fs.writeFileSync(path.join(settings, 'model_catalog.json'), '{}\n');
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
  // The host points the Agents page's link at DEEPTUTOR_HOME.
  const link = path.join(home, '.config', 'magpie', 'deeptutor-home');
  assert.equal(state.lastLoad.home.ok, true);
  assert.equal(fs.realpathSync(link), fs.realpathSync(deeptutorHome));
  fs.rmSync(root, { recursive: true, force: true });
});

test('plugin host links a directly installed desktop without changing environment', {
  skip: !['win32', 'darwin'].includes(process.platform),
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptutor-host-desktop-'));
  const home = path.join(root, 'home');
  const localAppData = path.join(root, 'Local AppData');
  const deeptutorHome = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'Open DeepTutor', 'workspace')
    : path.join(localAppData, 'Open DeepTutor', 'workspace');
  const settings = path.join(deeptutorHome, 'data', 'user', 'settings');
  fs.mkdirSync(settings, { recursive: true });
  fs.writeFileSync(path.join(settings, 'model_catalog.json'), '{}\n');
  fs.writeFileSync(path.join(settings, 'mcp.json'), JSON.stringify({ servers: {} }));

  const env = process.platform === 'darwin'
    ? { HOME: home }
    : { HOME: home, USERPROFILE: home, LOCALAPPDATA: localAppData };
  const hooks = await plugin.server({}, undefined, env);
  assert.deepEqual(hooks, {});
  assert.equal(env.DEEPTUTOR_HOME, undefined);
  assert.ok(fs.existsSync(path.join(settings, 'mcp.json')));
  const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'magpie', '.magpie-deeptutor-state.json'), 'utf8'));
  assert.equal(state.lastLoad.home.ok, true);
  assert.equal(state.lastLoad.home.target, deeptutorHome);
  assert.equal(state.lastLoad.environment, undefined);
  const link = path.join(home, '.config', 'magpie', 'deeptutor-home');
  assert.equal(fs.realpathSync(link), fs.realpathSync(deeptutorHome));
  fs.rmSync(root, { recursive: true, force: true });
});
