// Desktop workspace discovery for the normal Node/Bun plugin host.
//
// The declarative moejs agent cannot do this work. This module runs after a
// direct `magpie plugin add`, configures the current plugin host, and prepares
// the user environment for the next Magpie process. It never creates a desktop
// workspace or model catalog merely to make the agent appear installed.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { catalogOf, desktopWorkspace } from './home-paths.mjs';

const execFileAsync = promisify(execFile);
const LAUNCH_AGENT_LABEL = 'ai.deeptutor.magpie-environment';

const WINDOWS_PRESERVED_MARKER = 'MAGPIE_DEEPTUTOR_PRESERVED_EXISTING_HOME';
const WINDOWS_PERSIST_SCRIPT = `
$workspace = $env:MAGPIE_DEEPTUTOR_HOME_TO_PERSIST
$userHome = [Environment]::GetEnvironmentVariable('DEEPTUTOR_HOME', 'User')
$machineHome = [Environment]::GetEnvironmentVariable('DEEPTUTOR_HOME', 'Machine')
$existingHome = if (-not [string]::IsNullOrWhiteSpace($userHome)) { $userHome } else { $machineHome }
if (-not [string]::IsNullOrWhiteSpace($existingHome) -and $existingHome -ne $workspace) {
  Write-Output '${WINDOWS_PRESERVED_MARKER}'
  exit 0
}
[Environment]::SetEnvironmentVariable('DEEPTUTOR_HOME', $workspace, 'User')
if ([Environment]::GetEnvironmentVariable('DEEPTUTOR_HOME', 'User') -ne $workspace) {
  throw 'DEEPTUTOR_HOME user environment verification failed.'
}
`;

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function launchAgentPath(homeDirectory) {
  return path.join(homeDirectory, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

export function launchAgentContents(workspace) {
  const argumentsXml = ['/bin/launchctl', 'setenv', 'DEEPTUTOR_HOME', workspace]
    .map((value) => `    <string>${escapeXml(value)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
`;
}

async function persistWindows(workspace, { env, exec }) {
  // Pass the path through the child environment, not interpolated PowerShell
  // source, so quotes, spaces and metacharacters remain ordinary path text.
  // The child also checks persistent user/machine values because Magpie's parent
  // process may have started before an explicit value was added.
  const { stdout = '' } = await exec('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', WINDOWS_PERSIST_SCRIPT,
  ], {
    env: { ...env, MAGPIE_DEEPTUTOR_HOME_TO_PERSIST: workspace },
    timeout: 15000,
    windowsHide: true,
  });
  if (String(stdout).includes(WINDOWS_PRESERVED_MARKER)) {
    return { method: 'windows-user-environment', persisted: false, preserved: true };
  }
  return { method: 'windows-user-environment' };
}

async function persistMacOS(workspace, { env, exec, homeDirectory, uid }) {
  if (uid == null) throw new Error('Cannot determine the macOS GUI user id.');
  const plist = launchAgentPath(homeDirectory);
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  const temporary = `${plist}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, launchAgentContents(workspace), 'utf8');
  fs.renameSync(temporary, plist);

  const run = (command, args) => exec(command, args, {
    env,
    timeout: 15000,
    windowsHide: true,
  });

  // launchctl covers GUI applications started later in this login session. The
  // LaunchAgent restores the same generic rule after the next login.
  await run('launchctl', ['setenv', 'DEEPTUTOR_HOME', workspace]);
  const guiDomain = `gui/${uid}`;
  try {
    await run('launchctl', ['bootout', guiDomain, plist]);
  } catch {
    // Not loaded yet: bootstrap below is the expected first-install path.
  }
  try {
    await run('launchctl', ['bootstrap', guiDomain, plist]);
  } catch {
    // Older macOS versions use the legacy load command.
    await run('launchctl', ['load', plist]);
  }
  return { method: 'macos-launch-agent', plist };
}

export async function persistUserEnvironment(workspace, options = {}) {
  const {
    platformName = process.platform,
    env = process.env,
    exec = execFileAsync,
    homeDirectory = os.homedir(),
    uid = process.getuid?.(),
  } = options;
  if (!workspace) throw new Error('A DeepTutor workspace is required.');
  if (platformName === 'win32') return persistWindows(workspace, { env, exec });
  if (platformName === 'darwin') {
    return persistMacOS(workspace, { env, exec, homeDirectory, uid });
  }
  throw new Error('Automatic desktop environment persistence supports Windows and macOS only.');
}

export async function configureDesktopEnvironment(options = {}) {
  const {
    env = process.env,
    platformName = process.platform,
    homeDirectory = os.homedir(),
    exists = fs.existsSync,
    persist = persistUserEnvironment,
  } = options;

  // An explicit existing value is authoritative, even when it points at a
  // legacy/custom workspace. Automatic discovery must never silently move it.
  const configured = String(env.DEEPTUTOR_HOME || '').trim();
  if (configured) return { home: configured, source: 'environment', persisted: false };

  const workspace = desktopWorkspace(platformName, env, homeDirectory);
  if (!workspace || !exists(catalogOf(workspace))) {
    return { home: null, source: 'not-found', persisted: false };
  }

  // The Bun host can use the discovered path immediately for MCP sync. Magpie's
  // parent process still needs a restart before agent.dir can inherit it.
  env.DEEPTUTOR_HOME = workspace;
  if (env.MAGPIE_DEEPTUTOR_NO_PERSIST === '1') {
    return { home: workspace, source: 'desktop', persisted: false, skipped: true };
  }

  try {
    const persistence = await persist(workspace, { platformName, env, homeDirectory });
    return { home: workspace, source: 'desktop', persisted: true, ...persistence };
  } catch (error) {
    // Installation and current-host MCP sync can still succeed. The diagnostic
    // tells the user to configure the parent environment manually if needed.
    return {
      home: workspace,
      source: 'desktop',
      persisted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
