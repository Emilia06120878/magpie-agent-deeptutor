#!/usr/bin/env node
// Unit tests for the DeepTutor agent plugin.
//
// Plain Node, no Magpie needed. The important part is the *merge simulation*:
// it applies connect()'s key paths to a fixture catalog the same way Magpie does
// (dotted paths, intermediates created, arrays are leaves) and then checks that
// DeepTutor's own resolution rule still finds a usable model.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

import { agent, connect } from '../deeptutor.agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, 'fixtures', 'model_catalog.json');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

// --- Magpie's key-path merge semantics -------------------------------------
function setPath(root, dotted, value) {
  const keys = dotted.split('.');
  let node = root;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i];
    if (node[k] === null || typeof node[k] !== 'object' || Array.isArray(node[k])) node[k] = {};
    node = node[k];
  }
  node[keys[keys.length - 1]] = value;
}

function getPath(root, dotted) {
  return dotted.split('.').reduce((n, k) => (n == null ? n : n[k]), root);
}

function applyConnect(catalog, input) {
  const patch = connect(input);
  for (const [k, v] of Object.entries(patch)) setPath(catalog, k, structuredClone(v));
  return patch;
}

// --- DeepTutor's resolution rule -------------------------------------------
function resolveLlm(catalog) {
  const llm = catalog?.services?.llm;
  if (!llm) return null;
  const profile = (llm.profiles || []).find((p) => p?.id === llm.active_profile_id);
  if (!profile) return null;
  const model = (profile.models || []).find((m) => m?.id === llm.active_model_id);
  if (!model) return null;
  return { base_url: profile.base_url, api_key: profile.api_key, api_format: profile.api_format, model: model.model };
}

const gateway = { url: 'http://127.0.0.1:3425', v1: 'http://127.0.0.1:3425/v1', key: 'magpie-deeptutor' };
const model = { id: 'group/workbuddyqoderlobster-kimi-k3.1-pro', name: 'WorkbuddyQoderLobster-Kimi K3.1 Pro' };

console.log('agent declaration');
test('id/name/bin are set', () => {
  assert.equal(agent.id, 'deeptutor');
  assert.equal(agent.name, 'DeepTutor');
  assert.equal(agent.bin, 'deeptutor');
});
test('config points at the live catalog, not setup.json', () => {
  assert.match(agent.config, /\$DEEPTUTOR_HOME\/data\/user\/settings\/model_catalog\.json$/);
  assert.doesNotMatch(agent.config, /setup\.json/);
  assert.equal(agent.format, 'json');
});
test('model path matches the key connect() writes', () => {
  assert.equal(agent.model, 'services.llm.active_model_id');
});
test('notice tells the user a new chat is enough', () => {
  assert.match(agent.notice, /chat/i);
});
test('icon is an inline data: URL Magpie can render without network', () => {
  assert.match(agent.icon, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
  // 128x128 PNG of DeepTutor's own app icon: ~17 KB of base64. Small enough to
  // keep the module readable, large enough to stay sharp on a 2x display.
  assert.ok(agent.icon.length < 32768, 'icon should stay under 32 KB');
});
test('id is a legal Magpie agent id and does not shadow a built-in', () => {
  assert.match(agent.id, /^[a-z0-9._-]+$/);
  for (const builtin of ['codex', 'claude', 'gemini', 'opencode', 'pi', 'cursor', 'aider']) {
    assert.notEqual(agent.id, builtin);
  }
});
test('library declares a Claude-format MCP bridge', () => {
  assert.equal(agent.library.mcp, '~/.config/magpie/deeptutor-mcp-bridge.json');
  assert.equal(agent.library.mcpFormat, 'claude');
});

console.log('\nconnect() output');
test('returns exactly the three llm key paths', () => {
  const patch = connect({ gateway, model });
  assert.deepEqual(Object.keys(patch).sort(), [
    'services.llm.active_model_id',
    'services.llm.active_profile_id',
    'services.llm.profiles',
  ]);
});
test('profile is a single openai_chat route to the gateway', () => {
  const [profile] = connect({ gateway, model })['services.llm.profiles'];
  assert.equal(profile.id, 'llm-profile-magpie');
  assert.equal(profile.binding, 'custom');
  assert.equal(profile.base_url, 'http://127.0.0.1:3425');
  assert.equal(profile.api_key, 'magpie-deeptutor');
  assert.equal(profile.api_format, 'openai_chat');
  assert.equal(profile.wire_api, 'chat_completions');
  assert.equal(profile.models.length, 1);
  assert.equal(profile.models[0].model, model.id);
});
test('active_model_id equals the model entry id', () => {
  const patch = connect({ gateway, model });
  assert.equal(patch['services.llm.active_model_id'], patch['services.llm.profiles'][0].models[0].id);
});
test('trailing slashes on the gateway url are trimmed', () => {
  const patch = connect({ gateway: { ...gateway, url: 'http://127.0.0.1:3425///' }, model });
  assert.equal(patch['services.llm.profiles'][0].base_url, 'http://127.0.0.1:3425');
});
test('missing model id throws instead of writing garbage', () => {
  assert.throws(() => connect({ gateway, model: {} }), /no model id/);
});
test('missing gateway throws', () => {
  assert.throws(() => connect({ gateway: null, model }), /gateway/);
});

console.log('\nmerge + DeepTutor resolution');
test('after connect(), DeepTutor resolves the magpie route', () => {
  const catalog = JSON.parse(readFileSync(fixturePath, 'utf8'));
  applyConnect(catalog, { gateway, model });
  const resolved = resolveLlm(catalog);
  assert.deepEqual(resolved, {
    base_url: 'http://127.0.0.1:3425',
    api_key: 'magpie-deeptutor',
    api_format: 'openai_chat',
    model: model.id,
  });
});
test('the rest of the catalog is untouched', () => {
  const before = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const after = JSON.parse(readFileSync(fixturePath, 'utf8'));
  applyConnect(after, { gateway, model });
  assert.deepEqual(after.services.embedding, before.services.embedding);
  assert.deepEqual(after.services.search, before.services.search);
  assert.deepEqual(after.connectors ?? null, before.connectors ?? null);
});
test('switching models twice keeps one profile and the newest model', () => {
  const catalog = JSON.parse(readFileSync(fixturePath, 'utf8'));
  applyConnect(catalog, { gateway, model });
  applyConnect(catalog, { gateway, model: { id: 'group/oneday-glm5.3', name: 'oneday-GLM5.3' } });
  assert.equal(catalog.services.llm.profiles.length, 1);
  assert.equal(resolveLlm(catalog).model, 'group/oneday-glm5.3');
});
test('restoring the backed-up values gives the original array back', () => {
  const original = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const catalog = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const backup = structuredClone(original.services.llm.profiles);
  applyConnect(catalog, { gateway, model });
  // what magpie does on disconnect
  setPath(catalog, 'services.llm.profiles', backup);
  assert.deepEqual(catalog.services.llm.profiles, original.services.llm.profiles);
});
test('the model path agent.model actually holds the model id after connect', () => {
  const catalog = JSON.parse(readFileSync(fixturePath, 'utf8'));
  applyConnect(catalog, { gateway, model });
  assert.equal(getPath(catalog, agent.model), model.id);
});

console.log('\nall models at once');
const many = [
  { id: 'group/oneday-glm5.3', name: 'oneday-GLM5.3', context: 128000 },
  { id: 'group/workbuddyqoderlobster-kimi-k3.1-pro', name: 'Kimi K3.1 Pro', context: 1048576 },
  { id: 'zcode/GLM-5.2', name: 'GLM-5.2', context: 0 },
];
test('every model Magpie offers lands in the one profile, in order', () => {
  const patch = connect({ gateway, model: many[1], models: many });
  const [profile] = patch['services.llm.profiles'];
  assert.equal(patch['services.llm.profiles'].length, 1);
  assert.deepEqual(profile.models.map((m) => m.id), many.map((m) => m.id));
});
test('active_model_id points at an entry that exists', () => {
  const patch = connect({ gateway, model: many[1], models: many });
  const ids = patch['services.llm.profiles'][0].models.map((m) => m.id);
  assert.equal(patch['services.llm.active_model_id'], many[1].id);
  assert.ok(ids.includes(patch['services.llm.active_model_id']));
});
test('the picked model is appended when the catalog omitted it', () => {
  const outside = { id: 'group/not-in-the-list', name: 'Outside' };
  const patch = connect({ gateway, model: outside, models: many });
  const ids = patch['services.llm.profiles'][0].models.map((m) => m.id);
  assert.equal(ids[ids.length - 1], outside.id);
  assert.equal(patch['services.llm.active_model_id'], outside.id);
});
test('falls back to the picked model when models is absent, null, empty or not an array', () => {
  for (const models of [undefined, null, [], 'nope', 42, {}]) {
    const patch = connect({ gateway, model, models });
    assert.equal(patch['services.llm.profiles'][0].models.length, 1);
    assert.equal(patch['services.llm.profiles'][0].models[0].id, model.id);
  }
});
test('drops null entries and missing / blank ids', () => {
  const patch = connect({
    gateway,
    model,
    models: [null, {}, { id: null }, { id: '' }, { id: '   ' }, { id: 'ok/one' }, model],
  });
  assert.deepEqual(patch['services.llm.profiles'][0].models.map((m) => m.id), ['ok/one', model.id]);
});
test('de-duplicates ids, keeping the first position', () => {
  const patch = connect({
    gateway,
    model: { id: 'b' },
    models: [{ id: 'a', name: 'A' }, { id: 'b' }, { id: 'a', name: 'A again' }, { id: 'c' }],
  });
  const models = patch['services.llm.profiles'][0].models;
  assert.deepEqual(models.map((m) => m.id), ['a', 'b', 'c']);
  assert.equal(models[0].name, 'A');
});
test('still emits the picked entry when every other entry is invalid', () => {
  const patch = connect({ gateway, model, models: [null, {}, { id: '  ' }] });
  assert.deepEqual(patch['services.llm.profiles'][0].models.map((m) => m.id), [model.id]);
});
test('context_window is carried for a positive whole number', () => {
  const patch = connect({ gateway, model: many[0], models: many });
  assert.equal(patch['services.llm.profiles'][0].models[0].context_window, 128000);
});
test('context_window is omitted when Magpie reports 0 or a negative number', () => {
  for (const context of [0, -1, -128000]) {
    const patch = connect({ gateway, model: { id: 'm', context } });
    assert.equal('context_window' in patch['services.llm.profiles'][0].models[0], false);
  }
});
test('context_window is omitted for fractional, NaN and infinite contexts', () => {
  for (const context of [1.5, NaN, Infinity, -Infinity]) {
    const patch = connect({ gateway, model: { id: 'm', context } });
    assert.equal('context_window' in patch['services.llm.profiles'][0].models[0], false);
  }
});
test('context_window is not coerced from strings or null', () => {
  for (const context of ['128000', null, undefined]) {
    const patch = connect({ gateway, model: { id: 'm', context } });
    assert.equal('context_window' in patch['services.llm.profiles'][0].models[0], false);
  }
});
test('the models input is not mutated', () => {
  const input = JSON.parse(JSON.stringify(many));
  const snapshot = JSON.stringify(input);
  connect({ gateway, model: input[1], models: input });
  assert.equal(JSON.stringify(input), snapshot);
});
test('a three-model profile still resolves to the picked route in DeepTutor', () => {
  const catalog = JSON.parse(readFileSync(fixturePath, 'utf8'));
  applyConnect(catalog, { gateway, model: many[1], models: many });
  const resolved = resolveLlm(catalog);
  assert.equal(resolved.model, many[1].id);
  assert.equal(catalog.services.llm.profiles[0].models.length, 3);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.name}\n${f.err.stack}`);
  process.exit(1);
}
