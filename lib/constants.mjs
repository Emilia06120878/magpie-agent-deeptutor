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
export const HOME_LINK = 'deeptutor-home';

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

// Open DeepTutor (the desktop app) sets DEEPTUTOR_HOME only for the services it
// starts, so Magpie never sees it; its data folder is fixed per platform instead.
export function desktopHome(env = process.env, platform = process.platform) {
  if (platform === 'darwin') return path.join(homeDir(env), 'Library', 'Application Support', 'Open DeepTutor', 'workspace');
  if (platform === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'Open DeepTutor', 'workspace');
  return '';
}

export function catalogPath(home) {
  return path.join(home, 'data', 'user', 'settings', 'model_catalog.json');
}

// An explicit DEEPTUTOR_HOME wins; otherwise the desktop app's folder, if it has run.
export function deeptutorHome(env = process.env, platform = process.platform) {
  const explicit = expandHome(env.DEEPTUTOR_HOME || '', env);
  if (explicit) return explicit;
  const desktop = desktopHome(env, platform);
  return desktop && fs.existsSync(catalogPath(desktop)) ? desktop : '';
}

// The agent descriptor's fixed `dir`: Magpie cannot read the environment or
// probe paths, so the plugin host points this link at the real home and
// Magpie writes model_catalog.json through it (it follows symlinks).
export function homeLinkPath(env = process.env) {
  return path.join(configRoot(env), HOME_LINK);
}

// Points the link at the current home. Never deletes anything but the link
// itself: a recursive remove through it would erase the DeepTutor workspace.
export function linkHome(env = process.env, platform = process.platform) {
  const link = homeLinkPath(env);
  const found = deeptutorHome(env, platform);
  if (!found || !fs.existsSync(catalogPath(found))) {
    return { ok: false, link, reason: 'DeepTutor home not found: set DEEPTUTOR_HOME or run Open DeepTutor once' };
  }
  const target = path.resolve(found);
  let stat;
  try {
    stat = fs.lstatSync(link);
  } catch (error) {
    if (error.code !== 'ENOENT') return { ok: false, link, reason: error.message };
  }
  if (stat && !stat.isSymbolicLink()) {
    return { ok: false, link, reason: `${link} exists and is not a link; leaving it alone` };
  }
  try {
    if (stat && path.resolve(fs.readlinkSync(link)) === target) return { ok: true, link, target, created: false };
    if (stat) fs.unlinkSync(link);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    // 'junction' needs no admin rights on Windows and is ignored elsewhere.
    fs.symlinkSync(target, link, 'junction');
    return { ok: true, link, target, created: true };
  } catch (error) {
    return { ok: false, link, reason: error.message };
  }
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
