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
