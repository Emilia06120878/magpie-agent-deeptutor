#!/usr/bin/env node
// Preflight for the DeepTutor agent plugin.
//
// The plugin itself runs in Magpie's moejs sandbox and therefore cannot touch the
// filesystem or the environment. Everything that needs to look at the machine happens
// here, before you install the plugin:
//
//   1. desktop route      — the OS-specific Open DeepTutor workspace
//   2. environment route  — DEEPTUTOR_HOME
//   3. candidate paths    — common locations + the dir of the `deeptutor` binary
//   4. manual route       — --home <path> (always wins)
//
// It also reports the Library MCP bridge and DeepTutor's live mcp.json.
//
// Usage:
//   node tools/doctor.mjs
//   node tools/doctor.mjs --home <path>
//   node tools/doctor.mjs --json
//
// Exit codes: 0 ready, 1 not found, 2 found but not take-over-able (version/paths).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MCP_SERVER_PREFIX, mcpBridgePath, mcpConfigPath, statePath } from '../lib/constants.mjs';
import { catalogOf, desktopWorkspace } from '../lib/home-paths.mjs';

// tools/ lives one level below the package root — that is what you hand to `magpie plugin add`.
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIN_VERSION = [1, 7, 0];

function parseArgs(argv) {
  const out = { json: false, home: null, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--home') out.home = argv[++i] ?? null;
    else if (a.startsWith('--home=')) out.home = a.slice(7);
    else if (a === '-h' || a === '--help') {
      console.log('usage: node tools/doctor.mjs [--home <path>] [--json] [--quiet]');
      process.exit(0);
    }
  }
  return out;
}

function expand(p) {
  if (!p) return p;
  let out = p.replace(/\$(\w+)|\$\{(\w+)\}|%(\w+)%/g, (m, a, b, c) => process.env[a || b || c] ?? m);
  if (out === '~') out = homedir();
  else if (out.startsWith('~/') || out.startsWith('~\\')) out = path.join(homedir(), out.slice(2));
  return out;
}

function looksLikeHome(dir) {
  try {
    return existsSync(catalogOf(dir)) && statSync(catalogOf(dir)).isFile();
  } catch {
    return false;
  }
}

function findBinary() {
  const names = platform() === 'win32' ? ['deeptutor.exe', 'deeptutor.cmd', 'deeptutor'] : ['deeptutor'];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const n of names) {
      const full = path.join(d, n);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

function candidates() {
  const out = [];
  const push = (p, why) => {
    if (!p) return;
    const v = path.resolve(expand(p));
    if (!out.some((c) => c.path === v)) out.push({ path: v, why });
  };

  // The POSIX installer's explicit override has the same meaning here.
  push(process.env.MAGPIE_DEEPTUTOR_HOME, 'MAGPIE_DEEPTUTOR_HOME');
  // The managed desktop app is preferred when both editions are installed.
  // These locations come from the OS/current user, never from an app install path.
  push(desktopWorkspace(), 'Open DeepTutor desktop workspace');
  push(process.env.DEEPTUTOR_HOME, 'DEEPTUTOR_HOME');
  push(process.cwd(), 'current directory');

  const bin = findBinary();
  if (bin) {
    const dir = path.dirname(bin);
    push(dir, 'parent of the deeptutor binary');
    push(path.join(dir, '..'), 'grandparent of the deeptutor binary');
    push(path.join(dir, '..', 'workspace'), 'grandparent of the deeptutor binary + /workspace');
  }

  push('~/.deeptutor', 'candidate path');
  push('~/DeepTutor/workspace', 'candidate path');
  push('~/deeptutor/workspace', 'candidate path');
  push('/opt/deeptutor/workspace', 'candidate path');
  push('/usr/local/deeptutor/workspace', 'candidate path');
  if (process.env.LOCALAPPDATA) push(path.join(process.env.LOCALAPPDATA, 'DeepTutor', 'workspace'), 'candidate path');
  if (process.env.PROGRAMFILES) push(path.join(process.env.PROGRAMFILES, 'DeepTutor', 'workspace'), 'candidate path');

  return out;
}

// `deeptutor` has no --version flag (it is a click app: `deeptutor --version`
// answers "No such option"). The version is therefore read from the installed
// distribution's `deeptutor-<x.y.z>.dist-info` directory.
function distInfoRoots(home, bin) {
  const roots = [];
  const push = (p) => {
    if (p && !roots.includes(p)) roots.push(p);
  };

  if (bin) {
    const dir = path.dirname(bin);
    push(path.join(dir, '..', 'uv-tools', 'deeptutor', 'Lib', 'site-packages'));
    push(path.join(dir, '..', '..', 'uv-tools', 'deeptutor', 'Lib', 'site-packages'));
    push(path.join(dir, '..', 'Lib', 'site-packages'));
  }
  if (home) {
    push(path.join(home, '..', 'uv-tools', 'deeptutor', 'Lib', 'site-packages'));
    push(path.join(home, 'uv-tools', 'deeptutor', 'Lib', 'site-packages'));
    push(path.join(home, '.venv', 'lib'));
    push(path.join(home, '..', '.venv', 'lib'));
  }
  if (process.env.LOCALAPPDATA) {
    push(path.join(process.env.LOCALAPPDATA, 'uv', 'tools', 'deeptutor', 'Lib', 'site-packages'));
  }
  push(path.join(homedir(), '.local', 'share', 'uv', 'tools', 'deeptutor', 'lib'));
  push('/usr/local/lib/python3/dist-packages');
  push('/usr/lib/python3/dist-packages');
  return roots;
}

function scanForDistInfo(root) {
  const dirs = [root];
  try {
    for (const n of readdirSync(root)) {
      if (/^python\d+(\.\d+)?$/.test(n)) dirs.push(path.join(root, n, 'site-packages'));
    }
  } catch {
    return null;
  }
  for (const d of dirs) {
    try {
      const hit = readdirSync(d).find((n) => /^deeptutor-\d+\.\d+\.\d+\.dist-info$/.test(n));
      if (hit) {
        const v = /deeptutor-(\d+\.\d+\.\d+)\.dist-info/.exec(hit)[1];
        return { version: v, parts: v.split('.').map(Number), source: `dist-info in ${d}` };
      }
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function detectVersion(bin, home) {
  if (bin) {
    try {
      const raw = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
      const m = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
      if (m) return { version: m[0], parts: m.slice(1).map(Number), source: 'deeptutor --version' };
    } catch {
      /* no --version flag: fall through to dist-info */
    }
  }
  for (const root of distInfoRoots(home, bin)) {
    if (!existsSync(root)) continue;
    const hit = scanForDistInfo(root);
    if (hit) return hit;
  }
  return null;
}

function versionOk(parts) {
  for (let i = 0; i < 3; i += 1) {
    if ((parts[i] ?? 0) > MIN_VERSION[i]) return true;
    if ((parts[i] ?? 0) < MIN_VERSION[i]) return false;
  }
  return true;
}

function inspectCatalog(file) {
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const llm = json?.services?.llm;
    if (!llm) return { ok: false, reason: 'no services.llm section' };
    return {
      ok: true,
      profiles: Array.isArray(llm.profiles) ? llm.profiles.length : 0,
      activeProfileId: llm.active_profile_id ?? null,
      activeModelId: llm.active_model_id ?? null,
      magpieProfile: (llm.profiles || []).some((p) => p?.id === 'llm-profile-magpie'),
    };
  } catch (err) {
    return { ok: false, reason: `cannot parse: ${err.message}` };
  }
}

function inspectMcp(file) {
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const servers = json?.servers && typeof json.servers === 'object' && !Array.isArray(json.servers)
      ? json.servers
      : {};
    const names = Object.keys(servers);
    return {
      ok: true,
      exists: true,
      servers: names.length,
      userServers: names.filter((name) => !name.startsWith(MCP_SERVER_PREFIX)).length,
      syncedServers: names.filter((name) => name.startsWith(MCP_SERVER_PREFIX)).length,
    };
  } catch (err) {
    return { ok: false, exists: existsSync(file), reason: err.message };
  }
}

function inspectBridge(file) {
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const servers = json?.mcpServers && typeof json.mcpServers === 'object' && !Array.isArray(json.mcpServers)
      ? json.mcpServers
      : {};
    return { ok: true, exists: true, servers: Object.keys(servers).length };
  } catch (err) {
    return { ok: false, exists: existsSync(file), reason: err.message };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const found = [];
  for (const c of candidates()) {
    if (looksLikeHome(c.path)) found.push({ ...c, catalog: catalogOf(c.path), catalogInfo: inspectCatalog(catalogOf(c.path)) });
  }

  const chosen = args.home
    ? { path: path.resolve(expand(args.home)), why: '--home', catalog: catalogOf(path.resolve(expand(args.home))) }
    : found[0] ?? null;

  if (chosen && !chosen.catalogInfo) chosen.catalogInfo = inspectCatalog(chosen.catalog);

  const bin = findBinary();
  const desktopHome = desktopWorkspace();
  const desktop = Boolean(
    chosen && desktopHome && path.relative(path.resolve(expand(desktopHome)), chosen.path) === '',
  );
  // A desktop install may also have an unrelated legacy CLI on PATH. Do not
  // attribute that CLI's version to the desktop workspace or require the CLI.
  const version = desktop ? null : detectVersion(bin, chosen?.path);
  const doctorEnv = chosen ? { ...process.env, DEEPTUTOR_HOME: chosen.path } : process.env;
  const bridge = mcpBridgePath(doctorEnv);
  const mcp = mcpConfigPath(doctorEnv);
  const bridgeInfo = inspectBridge(bridge);
  const mcpInfo = inspectMcp(mcp);

  let verdict = 'ready';
  const problems = [];
  if (!chosen) verdict = 'not-found';
  else {
    if (!chosen.catalogInfo?.ok) problems.push(`model_catalog.json missing or invalid: ${chosen.catalogInfo?.reason ?? 'not found'}`);
    if (!desktop) {
      if (!version) problems.push('could not determine the DeepTutor version (run `deeptutor --version`)');
      else if (!versionOk(version.parts)) problems.push(`DeepTutor ${version.version} < 1.7.0: detected, but not take-over-able`);
      if (!bin) problems.push('`deeptutor` is not on PATH; run install.ps1/install.sh to configure DEEPTUTOR_HOME');
    }
    if (chosen) {
      // The plugin host creates the bridge and mcp.json on first load. A missing
      // file is normal before installation; an unreadable existing one is not.
      if (bridgeInfo.exists && !bridgeInfo.ok) problems.push(`MCP bridge file cannot be parsed: ${bridgeInfo.reason}`);
      if (mcpInfo.exists && !mcpInfo.ok) problems.push(`DeepTutor MCP registry cannot be parsed: ${mcpInfo.reason}`);
    }
    if (problems.length) verdict = version && !versionOk(version.parts) ? 'too-old' : 'not-ready';
  }

  const report = {
    verdict,
    problems,
    deeptutorHome: chosen?.path ?? null,
    foundBy: chosen?.why ?? null,
    catalogPath: chosen?.catalog ?? null,
    catalog: chosen?.catalogInfo ?? null,
    binary: desktop ? null : bin,
    desktop,
    version,
    minVersion: desktop ? null : MIN_VERSION.join('.'),
    allFound: found.map((f) => ({ path: f.path, why: f.why })),
    mcp: {
      bridgePath: bridge,
      bridge: bridgeInfo,
      configPath: mcp,
      config: mcpInfo,
      statePath: statePath(doctorEnv),
      syncedPrefix: MCP_SERVER_PREFIX,
    },
    suggested: chosen ? `DEEPTUTOR_HOME=${chosen.path}` : null,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(verdict === 'ready' ? 0 : verdict === 'too-old' ? 2 : 1);
  }

  if (!args.quiet) {
    console.log('DeepTutor preflight');
    console.log('  runtime       :', desktop ? 'Open DeepTutor desktop (managed)' : 'DeepTutor CLI');
    console.log('  binary        :', desktop ? '(not required)' : bin ?? '(not on PATH)');
    console.log('  version       :', desktop ? 'managed by the desktop app' : version ? `${version.version} (${version.source})` : 'unknown');
    console.log('  DEEPTUTOR_HOME:', chosen?.path ?? '(not found)');
    if (chosen) console.log('  found by      :', chosen.why);
    if (chosen) console.log('  catalog       :', chosen.catalog);
    if (chosen?.catalogInfo?.ok) {
      const c = chosen.catalogInfo;
      console.log(`  services.llm  : ${c.profiles} profile(s), active=${c.activeProfileId ?? 'null'}/${c.activeModelId ?? 'null'}`);
    }
    console.log('  MCP bridge    :', bridge);
    console.log('  MCP registry  :', mcp);
    if (bridgeInfo.ok) console.log(`  Library MCP   : ${bridgeInfo.servers} selected`);
    if (mcpInfo.ok) console.log(`  DeepTutor MCP : ${mcpInfo.servers} total, ${mcpInfo.syncedServers} synced, ${mcpInfo.userServers} user-owned`);
    if (found.length > 1) {
      console.log('  other hits    :');
      for (const f of found.slice(1)) console.log(`                  ${f.path}  (${f.why})`);
    }
    console.log('');
  }

  if (verdict === 'ready') {
    console.log('READY — the plugin can take over this installation.');
    console.log(`Install:  magpie plugin add ${PLUGIN_ROOT}`);
    console.log('Then:     magpie agents   (DeepTutor should be listed)');
    console.log('Library:  assign MCP servers to DeepTutor; the bridge syncs them to mcp.json');
    process.exit(0);
  }

  for (const p of problems) console.log(`PROBLEM: ${p}`);
  if (verdict === 'not-found') {
    console.log('');
    console.log('DeepTutor was not found. Set the home yourself and re-run:');
    console.log('  node tools/doctor.mjs --home "/path/that/contains/data/user/settings"');
  }
  process.exit(verdict === 'too-old' ? 2 : 1);
}

main();
