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

test('doctor prefers a real desktop workspace over a legacy environment override', {
  skip: !desktopPlatform,
}, (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const { report, status } = doctor([], sandboxEnv(f));
  assert.equal(status, 0, JSON.stringify(report.problems));
  assert.equal(report.verdict, 'ready');
  assert.equal(report.deeptutorHome, f.desktop);
  assert.equal(report.foundBy, 'Open DeepTutor desktop workspace');
  assert.equal(report.desktop, true);
  assert.equal(report.binary, null);
  assert.equal(report.version, null);
  assert.ok(report.allFound.some((entry) => entry.path === f.legacy));
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

test('Windows installer CheckOnly selects desktop without installing or persisting', {
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
  assert.ok(result.stdout.includes(f.desktop), result.stdout);
  assert.equal(env.DEEPTUTOR_HOME, f.legacy, 'parent environment must remain unchanged');
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

test('runtime rules and documentation contain no paths from the development machine', () => {
  const files = ['deeptutor.agent.mjs', 'install.ps1', 'install.sh', 'tools/doctor.mjs', 'lib/home-paths.mjs'];
  for (const relative of files) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.doesNotMatch(text, /E:\\DeepTutor|D:\\Open DeepTutor|33528/, relative);
  }
});
