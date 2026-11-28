import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCTOR = path.join(ROOT, 'tools', 'doctor.mjs');
const desktopPlatform = process.platform === 'win32' || process.platform === 'darwin';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-deeptutor-detection-'));
  const userHome = path.join(root, 'user-home');
  const local = path.join(root, 'local-app-data');
  const desktop = process.platform === 'win32'
    ? path.join(local, 'Open DeepTutor', 'workspace')
    : path.join(userHome, 'Library', 'Application Support', 'Open DeepTutor', 'workspace');
  const legacy = path.join(root, 'legacy-workspace');
  for (const home of [desktop, legacy]) {
    const settings = path.join(home, 'data', 'user', 'settings');
    fs.mkdirSync(settings, { recursive: true });
    fs.writeFileSync(path.join(settings, 'model_catalog.json'), JSON.stringify({
      services: { llm: { profiles: [], active_profile_id: null, active_model_id: null } },
    }));
  }
  fs.mkdirSync(userHome, { recursive: true });
  return { root, userHome, local, desktop, legacy };
}

function sandboxEnv(f) {
  return {
    ...process.env,
    HOME: f.userHome,
    USERPROFILE: f.userHome,
    LOCALAPPDATA: f.local,
    DEEPTUTOR_HOME: f.legacy,
    MAGPIE_DEEPTUTOR_HOME: '',
    PATH: '',
  };
}

function doctor(args, env) {
  const result = spawnSync(process.execPath, [DOCTOR, '--json', ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.signal, null, result.stderr);
  assert.ok(result.stdout, result.stderr);
  return { report: JSON.parse(result.stdout), status: result.status };
}

test('doctor discovers a desktop workspace without an environment override', {
  skip: !desktopPlatform,
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const { report, status } = doctor([], { ...sandboxEnv(f), DEEPTUTOR_HOME: '' });
  assert.equal(status, 0, JSON.stringify(report.problems));
  assert.equal(report.verdict, 'ready');
  assert.equal(report.deeptutorHome, f.desktop);
  assert.equal(report.foundBy, 'Open DeepTutor desktop workspace');
  assert.equal(report.desktop, true);
  assert.equal(report.binary, null);
  assert.equal(report.version, null);
  assert.equal(report.homeLink.status, 'missing');
  assert.ok(report.allFound.some((entry) => entry.path === f.desktop));
});

test('doctor gives an explicit DEEPTUTOR_HOME priority over desktop discovery', {
  skip: !desktopPlatform,
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const { report, status } = doctor([], sandboxEnv(f));
  assert.equal(status, 0, 'a valid explicit workspace does not require a CLI on PATH');
  assert.equal(report.deeptutorHome, f.legacy);
  assert.equal(report.foundBy, 'DEEPTUTOR_HOME');
  assert.equal(report.desktop, false);
  assert.ok(report.allFound.some((entry) => entry.path === f.desktop));
});

test('doctor reports an invalid explicit home instead of silently using desktop', {
  skip: !desktopPlatform,
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const missing = path.join(f.root, 'missing-explicit-home');
  const { report, status } = doctor([], { ...sandboxEnv(f), DEEPTUTOR_HOME: missing });
  assert.equal(status, 1);
  assert.equal(report.deeptutorHome, missing);
  assert.equal(report.foundBy, 'DEEPTUTOR_HOME');
  assert.equal(report.verdict, 'not-ready');
  assert.equal(fs.existsSync(missing), false);
});

test('doctor honors the POSIX installer explicit override before desktop discovery', {
  skip: !desktopPlatform,
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const env = { ...sandboxEnv(f), MAGPIE_DEEPTUTOR_HOME: f.legacy };
  const { report } = doctor([], env);
  assert.equal(report.deeptutorHome, f.legacy);
  assert.equal(report.foundBy, 'MAGPIE_DEEPTUTOR_HOME');
});

test('doctor --home still recognizes an explicitly selected desktop workspace', {
  skip: !desktopPlatform,
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const { report, status } = doctor(['--home', f.desktop], sandboxEnv(f));
  assert.equal(status, 0, JSON.stringify(report.problems));
  assert.equal(report.deeptutorHome, f.desktop);
  assert.equal(report.foundBy, '--home');
  assert.equal(report.desktop, true);
  assert.equal(report.version, null);
});

test('doctor --home is an explicit override and never writes the catalog', {
  skip: !desktopPlatform,
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const before = fs.readFileSync(path.join(f.legacy, 'data', 'user', 'settings', 'model_catalog.json'), 'utf8');
  const { report } = doctor(['--home', f.legacy], sandboxEnv(f));
  assert.equal(report.deeptutorHome, f.legacy);
  assert.equal(report.foundBy, '--home');
  assert.equal(fs.readFileSync(path.join(f.legacy, 'data', 'user', 'settings', 'model_catalog.json'), 'utf8'), before);
});

test('Windows installer CheckOnly honors an existing explicit home without persisting', {
  skip: process.platform !== 'win32',
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const env = { ...sandboxEnv(f), PATH: process.env.PATH };
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'install.ps1'), '-CheckOnly',
  ], { cwd: ROOT, env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DeepTutor workspace:/);
  assert.ok(result.stdout.includes(f.legacy), result.stdout);
  assert.equal(env.DEEPTUTOR_HOME, f.legacy, 'parent environment must remain unchanged');
});

test('Windows installer CheckOnly discovers desktop when no home is explicit', {
  skip: process.platform !== 'win32',
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const env = { ...sandboxEnv(f), DEEPTUTOR_HOME: '', PATH: process.env.PATH };
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'install.ps1'), '-CheckOnly',
  ], { cwd: ROOT, env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(f.desktop), result.stdout);
});

test('POSIX installer CheckOnly honors the explicit generic override', {
  skip: process.platform === 'win32',
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const env = { ...sandboxEnv(f), CHECK_ONLY: '1', MAGPIE_DEEPTUTOR_HOME: f.legacy };
  const result = spawnSync('sh', [path.join(ROOT, 'install.sh')], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(f.legacy), result.stdout);
});

test('doctor diagnoses a real directory occupying the home link path', {
  skip: !desktopPlatform,
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const link = path.join(f.userHome, '.config', 'magpie', 'deeptutor-home');
  fs.mkdirSync(link, { recursive: true });
  fs.writeFileSync(path.join(link, 'keep.txt'), 'keep');
  const { report, status } = doctor([], { ...sandboxEnv(f), DEEPTUTOR_HOME: '' });
  assert.equal(status, 1);
  assert.equal(report.verdict, 'not-ready');
  assert.equal(report.homeLink.status, 'not-a-link');
  assert.equal(report.homeLink.target, null);
  assert.equal(fs.readFileSync(path.join(link, 'keep.txt'), 'utf8'), 'keep');
});

test('doctor accepts a workspace reached through a symlinked parent', {
  skip: !desktopPlatform,
}, (t) => {
  const f = fixture();
  const alias = path.join(f.root, 'alias-root');
  t.after(() => {
    try { fs.unlinkSync(alias); } catch {}
    fs.rmSync(f.root, { recursive: true, force: true });
  });
  fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const aliasedEnv = {
    ...sandboxEnv(f),
    HOME: path.join(alias, 'user-home'),
    USERPROFILE: path.join(alias, 'user-home'),
    LOCALAPPDATA: path.join(alias, 'local-app-data'),
    DEEPTUTOR_HOME: '',
  };
  const chosen = path.join(alias, 'local-app-data', 'Open DeepTutor', 'workspace');
  const link = path.join(alias, 'user-home', '.config', 'magpie', 'deeptutor-home');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(chosen, link, process.platform === 'win32' ? 'junction' : 'dir');
  const { report, status } = doctor([], aliasedEnv);
  assert.equal(status, 0, JSON.stringify(report.problems));
  assert.equal(report.homeLink.status, 'linked');
  assert.equal(report.verdict, 'ready');
});

test('doctor rejects a home link that points to a different workspace', {
  skip: !desktopPlatform,
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const link = path.join(f.userHome, '.config', 'magpie', 'deeptutor-home');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(f.legacy, link, 'junction');
  const { report, status } = doctor([], { ...sandboxEnv(f), DEEPTUTOR_HOME: '' });
  assert.equal(status, 1);
  assert.equal(report.verdict, 'not-ready');
  assert.equal(report.homeLink.status, 'linked');
  assert.ok(report.problems.some((problem) => problem.includes('not the selected workspace')));
});

test('runtime rules and documentation contain no paths from the development machine', () => {
  const files = [
    'deeptutor.agent.mjs', 'index.mjs', 'install.ps1', 'install.sh',
    'tools/doctor.mjs', 'lib/home-paths.mjs', 'lib/constants.mjs',
  ];
  for (const relative of files) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.doesNotMatch(text, /E:\\DeepTutor|D:\\Open DeepTutor|33528/, relative);
  }
});

test('documentation and tests show no private or proxy address from the development machine', () => {
  // NO_PROXY in the README's troubleshooting example once held the development
  // machine's own LAN address and proxy range. Examples must stay invented.
  // Model names are not listed here on purpose: a list would publish the very
  // names it keeps out of the docs.
  const files = [
    'README.md', 'README.en.md', 'CHANGELOG.md',
    'docs/deeptutor-config.md', 'docs/deeptutor-mcp.md', 'docs/agent-plugin-contract.md',
    'test/run-tests.mjs', 'test/fixtures/model_catalog.json',
  ];
  // IPv4 only; IPv6 private addresses (fe80::/10, fc00::/7) are not checked.
  // 127.0.0.1 and ::1 are the plugin's own gateway and stay allowed, as do the
  // three RFC 5737 documentation blocks the examples use.
  const candidates = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g;
  for (const relative of files) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    for (const [address] of text.matchAll(candidates)) {
      assert.equal(isPrivateAddress(address), false, `${relative} shows a private or proxy address: ${address}`);
    }
  }
});

// Whether an a.b.c.d string is a private, loopback, link-local, CGNAT or
// fake-ip IPv4 address. Kept in plain arithmetic rather than one long regular
// expression so each range can be read and tested on its own.
function isPrivateAddress(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  // 127.0.0.1 is the gateway Magpie serves and appears throughout the docs.
  if (a === 127 && b === 0) return octets[2] !== 0 || octets[3] !== 1;
  if (a === 10 || a === 127) return true;
  if (a === 100) return b >= 64 && b <= 127; // CGNAT
  if (a === 169) return b === 254; // link-local
  if (a === 172) return b >= 16 && b <= 31;
  if (a === 192) return b === 168; // 192.0.2.x is documentation, not private
  if (a === 198) return b === 18 || b === 19; // fake-ip; 198.51.100.x is documentation
  return false;
}
