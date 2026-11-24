# Changelog

## 0.3.1 — 2026-11-24

**Automatic desktop configuration for direct plugin installs**

- Direct `magpie plugin add` installation now configures a standard Open
  DeepTutor desktop workspace from the normal plugin
  host, so running an external installer first is no longer required.
- Discovery still requires an existing desktop `model_catalog.json` and uses only
  standard Windows / macOS user data locations. No model catalog is created or
  modified by workspace discovery.
- Windows persists `DEEPTUTOR_HOME` for the current user; macOS uses `launchctl`
  and the plugin's per-user LaunchAgent. Existing non-empty values are preserved,
  and `MAGPIE_DEEPTUTOR_NO_PERSIST=1` provides a current-host-only opt-out.
- Persistence errors are diagnostic and do not prevent the plugin host or MCP
  bridge from loading. Both READMEs document direct installs, restart behavior,
  explicit overrides and troubleshooting.
- Added isolated tests for Windows and macOS discovery, persistence commands,
  special-character paths, existing configuration, missing catalogs, opt-out and
  failure fallback. Model routing and MCP sync formats are unchanged.

## 0.3.0 — 2026-11-24

**Open DeepTutor desktop discovery**

- Added generic desktop workspace discovery for Windows (`%LOCALAPPDATA%`) and
  macOS (the current user's `Library/Application Support`). No application
  install directory, user name or drive letter is hard-coded.
- `install.ps1` and `install.sh` now select an existing workspace, configure
  `DEEPTUTOR_HOME` for Magpie, and install the plugin. Desktop workspaces are
  preferred when both desktop and legacy CLI editions are present; explicit
  overrides remain available. Check-only modes allow a side-effect-free dry run.
- Windows persists the variable for the current user. macOS applies it through
  `launchctl` and a per-user LaunchAgent so restarted GUI processes can inherit it.
- `tools/doctor.mjs` recognizes the managed desktop runtime and no longer demands
  an unrelated legacy CLI binary or version for that workspace. `--home` remains
  the highest-priority override.
- Expanded unit/integration tests cover desktop preference, explicit overrides,
  read-only discovery, installer check-only behavior and machine-specific path
  regression checks. Both READMEs document detection, restart and troubleshooting.
- The model catalog and Library MCP sync formats are unchanged from 0.2.0.

## 0.2.0 — 2026-11-08

**Library MCP support**

- DeepTutor is now offered as a selectable agent in Magpie's Library → MCP through
  `agent.library.mcp` with `mcpFormat: "claude"`.
- `index.mjs` watches Magpie's Claude-shaped bridge file and translates selected
  HTTP, SSE and stdio servers into DeepTutor 1.7.0's `servers` registry at
  `$DEEPTUTOR_HOME/data/user/settings/mcp.json`.
- Synced servers carry the `magpie-deeptutor-` prefix. User-added servers and
  DeepTutor-owned fields on synced entries are preserved; stale owned entries
  are removed when a Library assignment is withdrawn. Unreadable bridge or
  registry JSON is never overwritten, and unsupported transports are reported.
- `tools/doctor.mjs` reports the bridge, the MCP registry and the synced/user-owned
  counts. New tests cover the descriptor, translation, ownership, empty selections,
  missing `DEEPTUTOR_HOME`, and the plugin host.
- The model route written by `connect()` is unchanged.

**Known limitation**

- DeepTutor does not watch `mcp.json`. Restart `deeptutor serve` (or save once in
  its MCP settings) to refresh live connections after a Library change.

## 0.1.0 — 2026-11-01

First public release.

**What it does**

- `kind: agent` plugin for Magpie: agent id `deeptutor`, display name `DeepTutor`, DeepTutor's own app icon.
- Writes DeepTutor's live LLM route into `$DEEPTUTOR_HOME/data/user/settings/model_catalog.json`:
  `services.llm.profiles`, `services.llm.active_profile_id`, `services.llm.active_model_id`.
  `setup.json` is left alone — it is only the input file of `deeptutor config apply`.
- Every model Magpie offers the agent is written into the single `llm-profile-magpie` profile, so
  DeepTutor's own model picker lists the whole Magpie catalog (60 models on a fully signed-in
  Magpie) and the user switches between them inside DeepTutor.
- `active_model_id` always points at an entry that exists: the picked model is appended when an
  incomplete model list omitted it.
- `context_window` is carried onto each model entry from Magpie's `context`, but only when it is a
  positive whole number — Magpie reports `0` for "unknown", which would otherwise tell DeepTutor
  the model has no context at all.
- Model ids are de-duplicated (first occurrence wins, input order preserved) and entries with
  missing, empty or whitespace-only ids are dropped instead of written.
- `models` that is missing, `null`, empty or not an array falls back to the picked model, so the
  plugin still works with an older Magpie. The `models` input is never mutated.
- Declares `model: "services.llm.active_model_id"`, so Magpie's model picker and the written config
  cannot drift apart.
- Detected through `bin: "deeptutor"` and `dir: "$DEEPTUTOR_HOME"`; never creates files just to be
  detected.
- `tools/doctor.mjs`: three-route discovery (environment / candidate paths / `--home`), version gate
  (>= 1.7.0), catalog validation, and the exact `DEEPTUTOR_HOME` to export.
- `test/run-tests.mjs`: 30 assertions, including a simulation of Magpie's key-path merge,
  DeepTutor's own profile → model resolution, and the disconnect restore path.

**Deliberate non-goals**

- Does not touch `setup.json`.
- Does not start or stop `deeptutor serve`.
- Does not touch the `embedding` / `search` sections.
- Not published to npm, not added to Magpie's official registry.
