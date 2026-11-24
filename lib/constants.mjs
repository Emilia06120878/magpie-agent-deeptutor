// Shared paths and JSON helpers for the DeepTutor Magpie plugin.
//
// The agent descriptor is a pure moejs module; these Node/Bun-compatible
// helpers are used only by the plugin host, tools and unit tests.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { catalogOf, desktopWorkspace } from './home-paths.mjs';

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
// starts, so Magpie never sees it. Keep home-paths.mjs as the single source of
// truth shared by the host, installers' tests and doctor.
export function desktopHome(env = process.env, platform = process.platform) {
  return desktopWorkspace(platform, env, homeDir(env)) || '';
}

export function catalogPath(home) {
  return catalogOf(home);
}

function usableHome(home, env) {
  if (!home) return false;
  const explicit = expandHome(env.DEEPTUTOR_HOME || '', env);
  if (explicit) {
    // Preserve the legacy CLI behavior for an initialized workspace directory
    // whose catalog has not been created yet, but never create a missing tree.
    try {
      return fs.statSync(home).isDirectory();
    } catch {
      return false;
    }
  }
  // Automatic desktop discovery is safe only after Open DeepTutor created its
  // own live catalog; the plugin must not initialize the application for it.
  return fs.existsSync(catalogPath(home));
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

// Re-check immediately before unlinking. There is no portable atomic
// compare-and-unlink API, but unlink itself is non-recursive: a last-moment
// replacement by a real directory fails instead of deleting its contents.
function unlinkLinkOnly(link, expected) {
  const current = fs.lstatSync(link);
  if (!current.isSymbolicLink()) {
    const error = new Error(`${link} is no longer a link; leaving it alone`);
    error.code = 'ENOTLINK';
    throw error;
  }
  if (expected && (
    current.dev !== expected.dev
    || current.ino !== expected.ino
    || current.mtimeMs !== expected.mtimeMs
  )) {
    const error = new Error(`${link} changed during setup; leaving it alone`);
    error.code = 'EAGAIN';
    throw error;
  }
  fs.unlinkSync(link);
}

// Points the link at the current home. Only the link itself is ever unlinked,
// never its target. A stale link is removed when no valid home remains so an
// old workspace cannot keep the agent detected or receive a recreated catalog.
export function linkHome(env = process.env, platform = process.platform) {
  const link = homeLinkPath(env);
  let stat;
  try {
    stat = fs.lstatSync(link);
  } catch (error) {
    if (error.code !== 'ENOENT') return { ok: false, link, reason: error.message };
  }

  const found = deeptutorHome(env, platform);
  if (!usableHome(found, env)) {
    const reason = expandHome(env.DEEPTUTOR_HOME || '', env)
      ? 'DEEPTUTOR_HOME is not an existing workspace directory'
      : 'DeepTutor home not found: set DEEPTUTOR_HOME or run Open DeepTutor once';
    if (!stat) return { ok: false, link, reason };
    if (!stat.isSymbolicLink()) return { ok: false, link, reason: `${reason}; ${link} is not a link and was left alone` };
    try {
      unlinkLinkOnly(link, stat);
      return { ok: false, link, reason, removed: true };
    } catch (error) {
      return { ok: false, link, reason: `${reason}; stale link could not be removed: ${error.message}` };
    }
  }

  if (stat && !stat.isSymbolicLink()) {
    return { ok: false, link, reason: `${link} exists and is not a link; leaving it alone` };
  }
  const target = path.resolve(found);
  try {
    if (stat) {
      try {
        const actual = fs.realpathSync(link);
        const expected = fs.realpathSync(target);
        const same = platform === 'win32'
          ? actual.toLowerCase() === expected.toLowerCase()
          : actual === expected;
        if (same) return { ok: true, link, target, created: false };
      } catch {
        // A dangling link is replaced below; its target is never touched.
      }
    }
    if (stat) unlinkLinkOnly(link, stat);
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
  // Never create a new DeepTutor tree just because an explicit path was set.
  if (!usableHome(home, env)) return '';
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
