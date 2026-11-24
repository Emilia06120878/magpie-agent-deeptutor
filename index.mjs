// Magpie plugin-host entry for the DeepTutor agent.
//
// The moejs agent descriptor cannot touch the filesystem. After a direct
// plugin add this host discovers an unconfigured desktop workspace and prepares
// DEEPTUTOR_HOME for the next Magpie process. It also keeps DeepTutor's
// deployment-wide mcp.json in sync with Magpie's Claude-shaped Library bridge
// while running. It opens no network listeners.

import fs from 'node:fs';
import {
  mcpBridgePath,
  mcpConfigPath,
  readJSON,
  statePath,
  writeJSONIfChanged,
} from './lib/constants.mjs';
import {
  ensureBridgeFile,
  syncMcpBridge,
} from './lib/mcp-bridge.mjs';
import { configureDesktopEnvironment } from './lib/desktop-environment.mjs';

let bridgeWatcher;

function syncBridge(env = process.env) {
  return syncMcpBridge({
    bridgeFile: mcpBridgePath(env),
    mcpFile: mcpConfigPath(env),
    stateFile: statePath(env),
  });
}

function watchBridge(env) {
  if (bridgeWatcher) return;
  const bridgeFile = mcpBridgePath(env);
  try {
    let pending;
    bridgeWatcher = fs.watch(bridgeFile, () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        try {
          syncBridge(env);
        } catch (error) {
          console.error('[magpie-agent-deeptutor] MCP bridge:', error.message);
        }
      }, 100);
      pending.unref?.();
    });
    bridgeWatcher.on('error', (error) => console.error('[magpie-agent-deeptutor] MCP bridge watch:', error.message));
    bridgeWatcher.unref?.();
  } catch (error) {
    console.error('[magpie-agent-deeptutor] MCP bridge watch:', error.message);
  }
}

function installation(env) {
  const bridgeFile = mcpBridgePath(env);
  const mcpFile = mcpConfigPath(env);
  const bridge = { created: ensureBridgeFile(bridgeFile), path: bridgeFile };
  const mcp = syncBridge(env);
  watchBridge(env);
  return { deeptutorHome: env.DEEPTUTOR_HOME || null, mcpFile: mcpFile || null, bridge, mcp };
}

async function runPlugin(input, options, env = process.env, environmentOptions = {}) {
  const environment = await configureDesktopEnvironment({ env, ...environmentOptions });
  if (environment.error) {
    console.error('[magpie-agent-deeptutor] desktop environment:', environment.error);
  }
  const result = installation(env);
  const file = statePath(env);
  writeJSONIfChanged(file, {
    ...(readJSON(file, {}) || {}),
    lastLoad: { ...result, environment },
    lastLoadAt: new Date().toISOString(),
  });
  return {};
}

export default {
  id: 'deeptutor-agent',
  server: runPlugin,
};
