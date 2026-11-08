// Shared paths and JSON helpers for the DeepTutor Magpie plugin.
//
// The agent descriptor is a pure moejs module; these Node/Bun-compatible
// helpers are used only by the plugin host, tools and unit tests.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const PLUGIN_ID = 'deeptutor';
export const MCP_BRIDGE_FILE = 'deeptutor-mcp-bridge.json';
export const MCP_CONFIG_FILE = 'mcp.json';
export const MCP_SERVER_PREFIX = 'magpie-deeptutor-';
export const STATE_FILE = '.magpie-deeptutor-state.json';

export function homeDir(env = process.env) {
  return env.HOME || env.USERPROFILE || os.homedir();
}

export function configRoot(env = process.env) {
  return path.join(homeDir(env), '.config', 'magpie');
}

export function mcpBridgePath(env = process.env) {
  return path.join(configRoot(env), MCP_BRIDGE_FILE);
}

export function statePath(env = process.env) {
  return path.join(configRoot(env), STATE_FILE);
}

export function expandHome(value, env = process.env) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const home = homeDir(env);
  const withHome = raw === '~' ? home : raw.startsWith('~/') || raw.startsWith('~\\')
    ? path.join(home, raw.slice(2))
    : raw;
  return withHome.replace(/\$(\w+)|\$\{(\w+)\}|%(\w+)%/g, (match, a, b, c) => {
    const value = env[a || b || c];
    return value == null ? match : value;
  });
}

export function deeptutorHome(env = process.env) {
  return expandHome(env.DEEPTUTOR_HOME || '', env);
}

export function mcpConfigPath(env = process.env) {
  const home = deeptutorHome(env);
  if (!home) return '';
  return path.join(home, 'data', 'user', 'settings', MCP_CONFIG_FILE);
}

export function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Unlike readJSON, this distinguishes a file that does not exist from one
// that exists but cannot be read or parsed. A sync must never treat unreadable
// user configuration as an empty document and overwrite it.
export function readJSONFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return { exists: true, value: JSON.parse(text) };
  } catch (error) {
    return { exists: fs.existsSync(file), error: error.message };
  }
}

export function writeJSON(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

export function writeJSONIfChanged(file, value) {
  if (JSON.stringify(readJSON(file)) === JSON.stringify(value)) return false;
  writeJSON(file, value);
  return true;
}

export function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
