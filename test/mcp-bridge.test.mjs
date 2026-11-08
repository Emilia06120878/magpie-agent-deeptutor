import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ensureBridgeFile,
  removeOwnedServers,
  syncMcpBridge,
  translateBridge,
} from '../lib/mcp-bridge.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deeptutor-mcp-'));
}

test('translates Claude-format HTTP, SSE and stdio entries', () => {
  const result = translateBridge({ mcpServers: {
    web: { type: 'http', url: 'http://127.0.0.1:3425/mcp/magpie/web', headers: { Authorization: 'Bearer k', bad: 1 } },
    events: { type: 'sse', url: 'https://example.test/sse' },
    tools: { type: 'stdio', command: 'node', args: ['tool.js', 7], env: { A: 'B', N: 2 } },
  } });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(Object.keys(result.servers), [
    'magpie-deeptutor-events',
    'magpie-deeptutor-tools',
    'magpie-deeptutor-web',
  ]);
  assert.equal(result.servers['magpie-deeptutor-web'].type, 'streamableHttp');
  assert.deepEqual(result.servers['magpie-deeptutor-web'].headers, { Authorization: 'Bearer k' });
  assert.equal(result.servers['magpie-deeptutor-events'].type, 'sse');
  assert.equal(result.servers['magpie-deeptutor-tools'].type, 'stdio');
  assert.deepEqual(result.servers['magpie-deeptutor-tools'].args, ['tool.js']);
  assert.deepEqual(result.servers['magpie-deeptutor-tools'].env, { A: 'B' });
});

test('preserves DeepTutor-owned fields and respects a disabled bridge entry', () => {
  const prior = { 'magpie-deeptutor-web': {
    type: 'streamableHttp', url: 'https://old.test', enabled: true,
    tool_timeout: 60, enabled_tools: ['search'], catalog_entry: 'mine',
  } };
  const { servers, errors } = translateBridge({ mcpServers: {
    web: { type: 'http', url: 'https://new.test', disabled: true, headers: { A: 'B' } },
  } }, prior);
  assert.deepEqual(errors, []);
  const server = servers['magpie-deeptutor-web'];
  assert.equal(server.url, 'https://new.test');
  assert.equal(server.enabled, false);
  assert.equal(server.tool_timeout, 60);
  assert.deepEqual(server.enabled_tools, ['search']);
  assert.equal(server.catalog_entry, 'mine');
});

test('rejects invalid and unsupported entries while translating valid ones', () => {
  const result = translateBridge({ mcpServers: {
    ok: { type: 'http', url: 'https://ok.test/mcp' },
    broken: { type: 'http', url: 'file:///not-http' },
    websocket: { type: 'websocket', url: 'https://ok.test/mcp' },
    noType: { url: 'https://ok.test/mcp' },
  } });
  assert.deepEqual(result.errors.map((e) => e.name), ['broken', 'noType', 'websocket']);
  assert.deepEqual(Object.keys(result.servers), ['magpie-deeptutor-ok']);
});

test('sync preserves user servers and removes only owned stale entries', () => {
  const dir = tempDir();
  const bridgeFile = path.join(dir, 'bridge.json');
  const mcpFile = path.join(dir, 'mcp.json');
  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(bridgeFile, JSON.stringify({ mcpServers: { one: { type: 'http', url: 'https://example.test/mcp' } } }));
  fs.writeFileSync(mcpFile, JSON.stringify({ servers: {
    mine: { type: 'stdio', command: 'mine' },
    'magpie-deeptutor-old': { type: 'stdio', command: 'old' },
  } }));
  const result = syncMcpBridge({ bridgeFile, mcpFile, stateFile });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  const mcp = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
  assert.deepEqual(Object.keys(mcp.servers), ['mine', 'magpie-deeptutor-one']);
  assert.deepEqual(mcp.servers.mine, { type: 'stdio', command: 'mine' });
  assert.equal(mcp.servers['magpie-deeptutor-one'].type, 'streamableHttp');
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).serverNames[0], 'magpie-deeptutor-one');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an empty bridge clears owned entries but keeps user entries', () => {
  const dir = tempDir();
  const bridgeFile = path.join(dir, 'bridge.json');
  const mcpFile = path.join(dir, 'mcp.json');
  assert.equal(ensureBridgeFile(bridgeFile), true);
  fs.writeFileSync(mcpFile, JSON.stringify({ servers: { mine: { command: 'x' }, 'magpie-deeptutor-old': { command: 'y' } } }));
  assert.equal(syncMcpBridge({ bridgeFile, mcpFile }).ok, true);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(mcpFile, 'utf8')).servers), ['mine']);
  assert.equal(removeOwnedServers(mcpFile), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('removing an invalid entry clears its error from state', () => {
  const dir = tempDir();
  const bridgeFile = path.join(dir, 'bridge.json');
  const mcpFile = path.join(dir, 'mcp.json');
  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(mcpFile, JSON.stringify({ servers: {} }));
  fs.writeFileSync(bridgeFile, JSON.stringify({ mcpServers: {
    bad: { type: 'websocket', url: 'https://example.test/mcp' },
  } }));
  assert.equal(syncMcpBridge({ bridgeFile, mcpFile, stateFile }).errors.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).errors.length, 1);

  fs.writeFileSync(bridgeFile, JSON.stringify({ mcpServers: {} }));
  const result = syncMcpBridge({ bridgeFile, mcpFile, stateFile });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).errors, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing DEEPTUTOR_HOME is reported rather than writing a root-relative file', () => {
  const result = syncMcpBridge({ bridgeFile: '/does/not/matter', mcpFile: '', env: {} });
  assert.equal(result.ok, false);
  assert.match(result.reason, /DEEPTUTOR_HOME/);
});

test('malformed bridge or mcp.json is never overwritten', () => {
  const dir = tempDir();
  const bridgeFile = path.join(dir, 'bridge.json');
  const mcpFile = path.join(dir, 'mcp.json');
  const beforeMcp = '{not json';
  fs.writeFileSync(bridgeFile, '{not json');
  fs.writeFileSync(mcpFile, beforeMcp);
  assert.match(syncMcpBridge({ bridgeFile, mcpFile }).reason, /bridge file cannot be parsed/);
  assert.equal(fs.readFileSync(mcpFile, 'utf8'), beforeMcp);

  fs.writeFileSync(bridgeFile, JSON.stringify({ mcpServers: {} }));
  assert.match(syncMcpBridge({ bridgeFile, mcpFile }).reason, /mcp\.json cannot be parsed/);
  assert.equal(fs.readFileSync(mcpFile, 'utf8'), beforeMcp);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('one bad bridge entry does not block valid changes or explicit removals', () => {
  const dir = tempDir();
  const bridgeFile = path.join(dir, 'bridge.json');
  const mcpFile = path.join(dir, 'mcp.json');
  fs.writeFileSync(bridgeFile, JSON.stringify({ mcpServers: {
    ok: { type: 'http', url: 'https://ok.test/mcp' },
    broken: { type: 'http', url: 'file:///bad' },
  } }));
  fs.writeFileSync(mcpFile, JSON.stringify({ servers: {
    mine: { command: 'mine' },
    'magpie-deeptutor-ok': { type: 'streamableHttp', url: 'https://stale.test' },
    'magpie-deeptutor-broken': { type: 'streamableHttp', url: 'https://old.test' },
  } }));
  const result = syncMcpBridge({ bridgeFile, mcpFile });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  const mcp = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
  assert.equal(mcp.servers['magpie-deeptutor-ok'].url, 'https://ok.test/mcp');
  assert.equal(mcp.servers['magpie-deeptutor-broken'].url, 'https://old.test');
  assert.deepEqual(mcp.servers.mine, { command: 'mine' });

  fs.writeFileSync(bridgeFile, JSON.stringify({ mcpServers: { broken: { type: 'http', url: 'file:///bad' } } }));
  syncMcpBridge({ bridgeFile, mcpFile });
  const after = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
  assert.equal(after.servers['magpie-deeptutor-ok'], undefined);
  assert.equal(after.servers['magpie-deeptutor-broken'].url, 'https://old.test');
  fs.rmSync(dir, { recursive: true, force: true });
});
