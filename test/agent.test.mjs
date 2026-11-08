import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { agent } from '../deeptutor.agent.mjs';
import { expandHome, mcpBridgePath, mcpConfigPath } from '../lib/constants.mjs';

test('agent descriptor declares a Claude-format MCP bridge', () => {
  assert.equal(agent.id, 'deeptutor');
  assert.equal(agent.library.mcpFormat, 'claude');
  assert.match(agent.library.mcp, /deeptutor-mcp-bridge\.json$/);
  assert.equal(agent.config, '$DEEPTUTOR_HOME/data/user/settings/model_catalog.json');
  assert.equal(agent.model, 'services.llm.active_model_id');
});

test('bridge and MCP paths resolve under HOME and DEEPTUTOR_HOME', () => {
  const env = { HOME: '/home/test', DEEPTUTOR_HOME: '/srv/deeptutor' };
  assert.equal(mcpBridgePath(env), path.join('/home/test', '.config/magpie/deeptutor-mcp-bridge.json'));
  assert.equal(mcpConfigPath(env), path.join('/srv/deeptutor', 'data/user/settings/mcp.json'));
  assert.equal(expandHome('$DEEPTUTOR_HOME/data', env), '/srv/deeptutor/data');
});
