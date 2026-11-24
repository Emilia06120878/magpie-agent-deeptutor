import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  configureDesktopEnvironment,
  launchAgentPath,
  persistUserEnvironment,
} from '../lib/desktop-environment.mjs';
import { catalogOf } from '../lib/home-paths.mjs';

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptutor-environment-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createCatalog(workspace) {
  const catalog = catalogOf(workspace);
  fs.mkdirSync(path.dirname(catalog), { recursive: true });
  fs.writeFileSync(catalog, '{}\n');
}

test('an existing DEEPTUTOR_HOME is preserved without persistence', async () => {
  let called = false;
  const env = { DEEPTUTOR_HOME: '/custom/DeepTutor/workspace' };
  const result = await configureDesktopEnvironment({
    env,
    platformName: 'win32',
    persist: async () => { called = true; },
  });
  assert.deepEqual(result, {
    home: '/custom/DeepTutor/workspace',
    source: 'environment',
    persisted: false,
  });
  assert.equal(called, false);
});

test('Windows direct installation discovers and persists the standard desktop workspace', async (t) => {
  const root = temporaryRoot(t);
  const localAppData = path.join(root, 'Local AppData');
  const workspace = path.join(localAppData, 'Open DeepTutor', 'workspace');
  createCatalog(workspace);
  const env = { LOCALAPPDATA: localAppData };
  let persisted;
  const result = await configureDesktopEnvironment({
    env,
    platformName: 'win32',
    homeDirectory: path.join(root, 'unused-home'),
    persist: async (candidate) => {
      persisted = candidate;
      return { method: 'test-windows' };
    },
  });
  assert.equal(persisted, workspace);
  assert.equal(env.DEEPTUTOR_HOME, workspace);
  assert.equal(result.home, workspace);
  assert.equal(result.source, 'desktop');
  assert.equal(result.persisted, true);
  assert.equal(result.method, 'test-windows');
});

test('macOS direct installation discovers the current user desktop workspace', async (t) => {
  const root = temporaryRoot(t);
  const home = path.join(root, 'Home Directory');
  const workspace = path.join(home, 'Library', 'Application Support', 'Open DeepTutor', 'workspace');
  createCatalog(workspace);
  const env = {};
  let persisted;
  const result = await configureDesktopEnvironment({
    env,
    platformName: 'darwin',
    homeDirectory: home,
    persist: async (candidate) => {
      persisted = candidate;
      return { method: 'test-macos' };
    },
  });
  assert.equal(persisted, workspace);
  assert.equal(env.DEEPTUTOR_HOME, workspace);
  assert.equal(result.persisted, true);
  assert.equal(result.method, 'test-macos');
});

test('discovery does nothing when no real desktop catalog exists', async (t) => {
  const root = temporaryRoot(t);
  const env = { LOCALAPPDATA: path.join(root, 'Local') };
  let called = false;
  const result = await configureDesktopEnvironment({
    env,
    platformName: 'win32',
    homeDirectory: root,
    persist: async () => { called = true; },
  });
  assert.deepEqual(result, { home: null, source: 'not-found', persisted: false });
  assert.equal(env.DEEPTUTOR_HOME, undefined);
  assert.equal(called, false);
});

test('an explicit no-persist switch still configures the current plugin host', async (t) => {
  const root = temporaryRoot(t);
  const localAppData = path.join(root, 'Local');
  const workspace = path.join(localAppData, 'Open DeepTutor', 'workspace');
  createCatalog(workspace);
  const env = { LOCALAPPDATA: localAppData, MAGPIE_DEEPTUTOR_NO_PERSIST: '1' };
  let called = false;
  const result = await configureDesktopEnvironment({
    env,
    platformName: 'win32',
    persist: async () => { called = true; },
  });
  assert.equal(env.DEEPTUTOR_HOME, workspace);
  assert.equal(result.skipped, true);
  assert.equal(result.persisted, false);
  assert.equal(called, false);
});

test('persistence failure is diagnostic and does not discard the discovered workspace', async (t) => {
  const root = temporaryRoot(t);
  const localAppData = path.join(root, 'Local');
  const workspace = path.join(localAppData, 'Open DeepTutor', 'workspace');
  createCatalog(workspace);
  const env = { LOCALAPPDATA: localAppData };
  const result = await configureDesktopEnvironment({
    env,
    platformName: 'win32',
    persist: async () => { throw new Error('simulated persistence failure'); },
  });
  assert.equal(env.DEEPTUTOR_HOME, workspace);
  assert.equal(result.persisted, false);
  assert.equal(result.error, 'simulated persistence failure');
});

test('Windows persistence passes the workspace out-of-band and verifies the user value', async () => {
  const workspace = 'C:\\Users\\Example User\\Open DeepTutor & Friends\\workspace';
  let invocation;
  const result = await persistUserEnvironment(workspace, {
    platformName: 'win32',
    env: { PATH: 'test-path' },
    exec: async (command, args, options) => {
      invocation = { command, args, options };
      return { stdout: '', stderr: '' };
    },
  });
  assert.equal(invocation.command, 'powershell.exe');
  assert.equal(invocation.options.env.MAGPIE_DEEPTUTOR_HOME_TO_PERSIST, workspace);
  assert.equal(invocation.options.env.PATH, 'test-path');
  assert.equal(invocation.options.windowsHide, true);
  assert.ok(invocation.args.includes('-NonInteractive'));
  assert.ok(!invocation.args.join('\n').includes(workspace));
  assert.match(invocation.args.at(-1), /SetEnvironmentVariable\('DEEPTUTOR_HOME'/);
  assert.match(invocation.args.at(-1), /GetEnvironmentVariable\('DEEPTUTOR_HOME'/);
  assert.equal(result.method, 'windows-user-environment');
});

test('Windows persistence honors a conflicting value already stored for the user or machine', async () => {
  let script;
  const result = await persistUserEnvironment('C:\\Users\\Example\\Desktop\\workspace', {
    platformName: 'win32',
    env: {},
    exec: async (_command, args) => {
      script = args.at(-1);
      return { stdout: 'MAGPIE_DEEPTUTOR_PRESERVED_EXISTING_HOME\r\n', stderr: '' };
    },
  });
  assert.match(script, /GetEnvironmentVariable\('DEEPTUTOR_HOME', 'User'\)/);
  assert.match(script, /GetEnvironmentVariable\('DEEPTUTOR_HOME', 'Machine'\)/);
  assert.match(script, /IsNullOrWhiteSpace/);
  assert.equal(result.persisted, false);
  assert.equal(result.preserved, true);
});

test('blank process values permit discovery and persistent-value preservation is propagated', async (t) => {
  const root = temporaryRoot(t);
  const localAppData = path.join(root, 'Local');
  const workspace = path.join(localAppData, 'Open DeepTutor', 'workspace');
  createCatalog(workspace);
  const env = { LOCALAPPDATA: localAppData, DEEPTUTOR_HOME: '   ' };
  const result = await configureDesktopEnvironment({
    env,
    platformName: 'win32',
    persist: async () => ({ persisted: false, preserved: true }),
  });
  assert.equal(env.DEEPTUTOR_HOME, workspace);
  assert.equal(result.source, 'desktop');
  assert.equal(result.persisted, false);
  assert.equal(result.preserved, true);
});

test('macOS persistence writes an escaped LaunchAgent and supports legacy load fallback', async (t) => {
  const root = temporaryRoot(t);
  const home = path.join(root, 'Test Home');
  const workspace = path.join(home, 'Open DeepTutor & <Friends>', 'workspace');
  const calls = [];
  const result = await persistUserEnvironment(workspace, {
    platformName: 'darwin',
    homeDirectory: home,
    uid: 501,
    env: {},
    exec: async (command, args) => {
      calls.push({ command, args });
      if (args[0] === 'bootout' || args[0] === 'bootstrap') {
        throw new Error(`simulated ${args[0]} failure`);
      }
      return { stdout: '', stderr: '' };
    },
  });
  const plist = launchAgentPath(home);
  const contents = fs.readFileSync(plist, 'utf8');
  assert.ok(contents.includes('Open DeepTutor &amp; &lt;Friends&gt;'));
  assert.ok(contents.includes('<key>RunAtLoad</key>'));
  assert.ok(contents.includes('<string>Aqua</string>'));
  assert.deepEqual(calls.map((call) => call.args[0]), ['setenv', 'bootout', 'bootstrap', 'load']);
  assert.deepEqual(calls[0].args, ['setenv', 'DEEPTUTOR_HOME', workspace]);
  assert.equal(calls.at(-1).command, 'launchctl');
  assert.deepEqual(calls.at(-1).args, ['load', plist]);
  assert.equal(result.plist, plist);
});

test('unsupported platforms do not get implicit environment persistence', async () => {
  await assert.rejects(
    persistUserEnvironment('/tmp/workspace', { platformName: 'linux' }),
    /Windows and macOS only/,
  );
});
