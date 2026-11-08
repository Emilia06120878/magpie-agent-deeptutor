// Translate Magpie's Claude-shaped MCP bridge into DeepTutor 1.7.0's
// `{"servers": {"name": MCPServerConfig}}` registry.
//
// Only names carrying MCP_SERVER_PREFIX are owned by this plugin. DeepTutor's
// own servers and hand-written fields on synced entries are preserved, and
// stale owned entries are removed when the Library selection changes.

import fs from 'node:fs';
import {
  isRecord,
  MCP_SERVER_PREFIX,
  readJSON,
  readJSONFile,
  writeJSONIfChanged,
} from './constants.mjs';

const SERVER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const HTTP_URL = /^https?:\/\//i;

function isOwned(name) {
  return typeof name === 'string' && name.startsWith(MCP_SERVER_PREFIX);
}

function strMap(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string'));
}

function strList(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

function ownedFieldsOnly(entry) {
  const out = {};
  for (const key of ['command', 'args', 'env', 'cwd', 'url', 'headers']) {
    if (entry[key] !== undefined) out[key] = entry[key];
  }
  return out;
}

function translationError(name, reason) {
  return { name, reason };
}

/**
 * @param {unknown} bridge Magpie's `{"mcpServers": {...}}` document.
 * @param {Record<string, unknown>} existing DeepTutor's current `servers` map.
 */
export function translateBridge(bridge, existing = {}) {
  const entries = isRecord(bridge) && isRecord(bridge.mcpServers) ? bridge.mcpServers : {};
  const current = isRecord(existing) ? existing : {};
  const servers = {};
  const errors = [];

  for (const [name, value] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    const targetName = MCP_SERVER_PREFIX + name;
    if (!SERVER_NAME.test(targetName)) {
      errors.push(translationError(name, 'name is not supported by DeepTutor'));
      continue;
    }
    if (!isRecord(value)) {
      errors.push(translationError(name, 'not an object'));
      continue;
    }

    const prior = isRecord(current[targetName]) ? current[targetName] : {};
    const common = {
      ...prior,
      enabled: value.disabled === true ? false : true,
    };
    const type = typeof value.type === 'string' ? value.type : '';
    const url = typeof value.url === 'string' ? value.url.trim() : '';
    const command = typeof value.command === 'string' ? value.command.trim() : '';

    if (type !== 'http' && type !== 'sse' && type !== 'stdio') {
      errors.push(translationError(name, `unsupported transport ${type || '(none)'}`));
      continue;
    }

    if (type === 'stdio' || (!url && command)) {
      if (!command) {
        errors.push(translationError(name, 'missing command'));
        continue;
      }
      servers[targetName] = {
        ...common,
        ...ownedFieldsOnly(value),
        type: 'stdio',
        command,
        args: strList(value.args),
        env: strMap(value.env),
        url: '',
        headers: {},
      };
    } else {
      if (!HTTP_URL.test(url)) {
        errors.push(translationError(name, 'missing or invalid URL'));
        continue;
      }
      const transport = type === 'sse' ? 'sse' : 'streamableHttp';
      servers[targetName] = {
        ...common,
        ...ownedFieldsOnly(value),
        type: transport,
        url,
        headers: strMap(value.headers),
        command: '',
        args: [],
        env: {},
      };
    }
  }

  return { servers, errors };
}

export function syncMcpBridge({ bridgeFile, mcpFile, stateFile, env = process.env } = {}) {
  if (!mcpFile) return { ok: false, reason: 'DEEPTUTOR_HOME is not set' };
  const bridgeFileRead = readJSONFile(bridgeFile);
  if (bridgeFileRead.exists && 'error' in bridgeFileRead) {
    return { ok: false, reason: 'MCP bridge file cannot be parsed', errors: [{ name: bridgeFile, reason: bridgeFileRead.error }] };
  }
  const mcpFileRead = readJSONFile(mcpFile);
  if (mcpFileRead.exists && 'error' in mcpFileRead) {
    return { ok: false, reason: 'mcp.json cannot be parsed', errors: [{ name: mcpFile, reason: mcpFileRead.error }] };
  }
  const bridge = bridgeFileRead.exists ? bridgeFileRead.value : { mcpServers: {} };
  const mcp = mcpFileRead.exists ? mcpFileRead.value : {};
  if (!isRecord(mcp)) return { ok: false, reason: 'mcp.json is not an object' };
  if ('servers' in mcp && !isRecord(mcp.servers)) return { ok: false, reason: 'mcp.json servers is not an object' };
  const previous = isRecord(mcp.servers) ? mcp.servers : {};
  const userServers = Object.fromEntries(Object.entries(previous).filter(([name]) => !isOwned(name)));
  const { servers, errors } = translateBridge(bridge, previous);
  // A bad Library entry is skipped, but valid entries are still translated.
  // Errors are surfaced in state rather than freezing the whole registry on
  // one malformed server. Entries missing because they were unassigned are
  // removed; an entry still selected but currently invalid keeps its previous
  // configuration until the Library fixes or removes it.
  const failedNames = new Set(errors.map((error) => MCP_SERVER_PREFIX + error.name));
  const stale = Object.fromEntries(Object.entries(previous).filter(([name]) => isOwned(name) && failedNames.has(name)));
  const next = { ...mcp, servers: { ...userServers, ...servers, ...stale } };
  const changed = writeJSONIfChanged(mcpFile, next);
  const state = {
    plugin: 'magpie-agent-deeptutor',
    bridgeMtimeMs: fs.existsSync(bridgeFile) ? fs.statSync(bridgeFile).mtimeMs : 0,
    serverNames: Object.keys(servers),
    errors,
    updatedAt: new Date().toISOString(),
  };
  // Errors can clear without mcp.json changing (an invalid entry that was
  // never written is simply unassigned), so keep the state's error list in
  // step with the current result as well as the registry.
  if (stateFile) {
    const previousState = readJSON(stateFile, {});
    const resultChanged = previousState?.bridgeMtimeMs !== state.bridgeMtimeMs
      || JSON.stringify(previousState?.serverNames || []) !== JSON.stringify(state.serverNames)
      || JSON.stringify(previousState?.errors || []) !== JSON.stringify(state.errors);
    if (changed || resultChanged || !fs.existsSync(stateFile)) writeJSONIfChanged(stateFile, state);
  }
  return {
    ok: errors.length === 0,
    ...(errors.length ? { reason: 'invalid MCP bridge entries' } : {}),
    changed,
    count: Object.keys(servers).length,
    errors,
  };
}

export function removeOwnedServers(mcpFile) {
  const mcp = readJSON(mcpFile, {});
  if (!isRecord(mcp) || !isRecord(mcp.servers)) return false;
  const servers = Object.fromEntries(Object.entries(mcp.servers).filter(([name]) => !isOwned(name)));
  if (Object.keys(servers).length === Object.keys(mcp.servers).length) return false;
  return writeJSONIfChanged(mcpFile, { ...mcp, servers });
}

export function ensureBridgeFile(bridgeFile) {
  if (fs.existsSync(bridgeFile)) return false;
  return writeJSONIfChanged(bridgeFile, { mcpServers: {} });
}

export const _internal = { isOwned, strMap, strList };
