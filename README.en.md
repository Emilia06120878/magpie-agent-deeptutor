[English](README.en.md) | [简体中文](README.md)

# DeepTutor · Magpie Agent

Lets DeepTutor use every model and routing group configured in Magpie, and syncs MCP servers assigned to DeepTutor in Magpie's Library. Magpie's Agent page does not know DeepTutor by default; once this plugin is installed it appears in the list.
Supports the **Open DeepTutor desktop app (Windows / macOS)** and **DeepTutor CLI ≥ 1.7.0 (Windows / macOS / Linux)**.

---

## Features

- **Every model in one write**: the models and routing groups configured in Magpie are written into DeepTutor in a single pass, and are switched afterwards from DeepTutor's own model list without returning to Magpie.
- **The same configuration DeepTutor reads**: writes `model_catalog.json`, the file DeepTutor resolves its LLM route from. DeepTutor's source and startup are untouched.
- **Restored on disconnect**: original values are backed up per key, and disconnecting or uninstalling restores the configuration as it was before, leaving existing profiles intact.
- **Library MCP servers**: assign MCP servers to DeepTutor in Magpie's Library; the plugin translates them into DeepTutor's `mcp.json` without overwriting servers you added yourself.
- **Nothing else touched**: model sync leaves `embedding`, `search` and `setup.json` alone; MCP sync writes only `servers` in `mcp.json`.
- **Desktop auto-detection**: the installer locates Open DeepTutor from standard OS data directories, without depending on a user name, drive letter, app install folder or legacy `deeptutor` command.

---

### Installation

One command, from a terminal:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Emilia06120878/magpie-agent-deeptutor/main/install.sh | sh
```

```powershell
# Windows
powershell -c "irm https://raw.githubusercontent.com/Emilia06120878/magpie-agent-deeptutor/main/install.ps1 | iex"
```

**For the new desktop app, prefer the installer.** It discovers the standard data directory, configures `DEEPTUTOR_HOME` for Magpie, and only then installs the plugin. Windows stores it in the current user's environment; macOS uses `launchctl` and a per-user LaunchAgent. Restart Magpie afterwards so it inherits the environment.

Or add the repository from Magpie → **Plugins**:

```text
github:Emilia06120878/magpie-agent-deeptutor
```

Or with the Magpie CLI: `magpie plugin add github:Emilia06120878/magpie-agent-deeptutor`

> Adding the plugin directly does not run workspace discovery. If Magpie says “not detected”, use the installer above, or run the preflight check and configure `DEEPTUTOR_HOME` as described below.

---

## Install and first run

### Prerequisites

- **Magpie** installed, with the gateway answering on `127.0.0.1:3425`.
- The **Open DeepTutor desktop app**, or **DeepTutor CLI 1.7.0 or newer**, installed and started once so that `data/user/settings/model_catalog.json` exists.
- The installer discovers the workspace for you. For a manual install, `DEEPTUTOR_HOME` must be visible to **Magpie's process environment**; setting it only in DeepTutor's own launcher is not enough.
- At least one model or routing group configured in Magpie, plus at least one MCP server in the Library if you want MCP tools.

### Steps

1. **Run the preflight check**: `node tools/doctor.mjs`. It discovers the DeepTutor directory, validates the version and the catalog, and prints the `DEEPTUTOR_HOME` value to export.
2. **Install the plugin**: run the one-line installer above, or `magpie plugin add github:Emilia06120878/magpie-agent-deeptutor`. Then `magpie ls` should list DeepTutor.
3. **Select a model in Magpie**: Agents page → **DeepTutor** → model.
4. **Switch models in DeepTutor**: open DeepTutor's own settings; the `Magpie` profile already lists every model.
5. **Assign MCP servers**: Magpie → Library → MCP, and assign the servers you need to **DeepTutor**; the plugin syncs them into DeepTutor's MCP registry.

> DeepTutor resolves its model route when a chat starts, so a new chat is enough. It reloads MCP connections at startup or when its settings API saves a server. For a long-lived `deeptutor serve` process, restarting once is the reliable way to apply both model and MCP changes. The plugin neither starts nor stops that service.

---

## How desktop detection works

The Open DeepTutor desktop app does not require a `deeptutor` command and does not keep its writable data in the application install folder. The installer and preflight tool use these **standard OS locations**:

| Platform | Workspace |
| :--- | :--- |
| Windows | `%LOCALAPPDATA%\Open DeepTutor\workspace` |
| macOS | `~/Library/Application Support/Open DeepTutor/workspace` |

Discovery requires an existing `data/user/settings/model_catalog.json`; it never creates a file just to make detection succeed. The selected workspace is passed to the descriptor's `$DEEPTUTOR_HOME`, allowing Magpie's directory check to detect DeepTutor.

- When both editions are installed, the Open DeepTutor desktop workspace wins by default.
- On Windows, `.\install.ps1 -Workspace <workspace>` explicitly overrides it; add `-CheckOnly` to inspect without installing or changing the environment.
- On macOS / Linux, use `MAGPIE_DEEPTUTOR_HOME=<workspace>`; `CHECK_ONLY=1 sh install.sh` only inspects.
- From a source checkout, `node tools/doctor.mjs --json` shows the selected workspace. `--home <workspace>` has the highest priority; the doctor also honors the installer's explicit `MAGPIE_DEEPTUTOR_HOME` override.
- Fully restart Magpie after changing its environment. The plugin does not read or write DeepTutor's app install directory, and its rules contain no machine-specific user names or drive letters.

---

## Commands

| Action | Command |
| :--- | :--- |
| **Preflight check** | `node tools/doctor.mjs` |
| **Install the plugin** | `curl -fsSL https://raw.githubusercontent.com/Emilia06120878/magpie-agent-deeptutor/main/install.sh \| sh` |
| **Install without the script** | `magpie plugin add github:Emilia06120878/magpie-agent-deeptutor` |
| **List detected agents** | `magpie ls` |
| **Show DeepTutor's takeover state** | `magpie deeptutor` |
| **Disconnect and restore the config** | `magpie deeptutor default` |
| **Remove the plugin** | `magpie plugin rm magpie-agent-deeptutor` |
| **Run the unit tests** | `npm test` |

---

## Architecture

```text
Magpie Agent page
    │  model selected
    ▼
Magpie agent plugin deeptutor.agent.mjs
    │  receives the gateway and the model list
    ▼
writes three key paths
    $DEEPTUTOR_HOME/data/user/settings/model_catalog.json
      services.llm.profiles[]          ← every model Magpie provides
      services.llm.active_profile_id   ← llm-profile-magpie
      services.llm.active_model_id     ← the model selected in Magpie
    │
    ▼
DeepTutor starts a chat
    │  active_profile_id → profile → active_model_id
    ▼
local Magpie gateway http://127.0.0.1:3425
    ▼
model provider
```

### Library MCP servers

Magpie has no native `mcpFormat` for DeepTutor's `servers` object, so the plugin uses the same bridge pattern as the Toonflow plugin:

```text
Magpie Library assignment
  → ~/.config/magpie/deeptutor-mcp-bridge.json (claude / mcpServers)
  → index.mjs watches the bridge and translates it
  → $DEEPTUTOR_HOME/data/user/settings/mcp.json (DeepTutor / servers)
```

Synced entries carry the `magpie-deeptutor-` prefix. The plugin replaces or removes only entries with that prefix; manually added servers and DeepTutor-owned fields such as timeouts and tool allowlists are preserved. HTTP becomes `streamableHttp`, SSE stays `sse`, and command servers become `stdio`. See [docs/deeptutor-mcp.md](docs/deeptutor-mcp.md).

The resulting `services.llm` structure (abridged):

```json
{
  "services": {
    "llm": {
      "profiles": [
        {
          "id": "llm-profile-magpie",
          "name": "Magpie",
          "binding": "custom",
          "base_url": "http://127.0.0.1:3425",
          "api_key": "magpie-deeptutor",
          "api_format": "openai_chat",
          "models": [
            { "id": "group/oneday-glm5.3", "model": "group/oneday-glm5.3", "context_window": 128000 },
            { "id": "group/workbuddyqoderlobster-kimi-k3.1-pro", "model": "group/workbuddyqoderlobster-kimi-k3.1-pro", "context_window": 1048576 }
          ]
        }
      ],
      "active_profile_id": "llm-profile-magpie",
      "active_model_id": "group/oneday-glm5.3"
    }
  }
}
```

---

## Notes

- Prefer letting the installer set `DEEPTUTOR_HOME`. For a manual install without it, Magpie expands the model path to the drive root and MCP sync is refused; `tools/doctor.mjs` reports this beforehand.
- The legacy CLI requires DeepTutor 1.7.0 or newer. The desktop app uses its managed runtime, so neither a `deeptutor` command nor the version of an unrelated legacy CLI is required.
- A model switch takes effect on the next chat; for a long-lived `deeptutor serve` process, restarting once is safer.
- DeepTutor does not watch `mcp.json`. After Library MCP assignments change, restart `deeptutor serve` to refresh live MCP connections.

---

## Troubleshooting

### The new desktop app is installed, but Magpie says “not detected”

Start Open DeepTutor once, run this repository's Windows / macOS installer, and fully restart Magpie. Do not only repeat `magpie plugin add`: that command does not configure the workspace environment variable.

From a source checkout, run `node tools/doctor.mjs`. `Open DeepTutor desktop workspace` confirms that the new app was found. If another directory was selected, use the installer's explicit override. Also check that the model configuration path shown by `magpie ls` ends in `data/user/settings/model_catalog.json` under the selected workspace, rather than pointing at a drive root.

### `Invalid port: ':1]'` on a chat

This is an environment issue, not a plugin one. When `NO_PROXY` contains both `::1` and `[::1]`, httpx expands `[::1]` into `all://*[::1]`, fails to parse it, and DeepTutor raises the error while building the model connection:

```
httpx.InvalidURL: Invalid port: ':1]'
```

Drop `[::1]` from `NO_PROXY` and keep `::1`:

```text
NO_PROXY=10.69.24.25,198.18.0.1,.local,localhost,127.0.0.1,::1
```

### A model switch does not take effect

DeepTutor resolves its model route when a chat starts. A new chat is enough; for a long-lived `deeptutor serve` process, restarting once is safer.

### The model list is empty after takeover

No usable model is configured in Magpie yet. Add an account or a model in Magpie, then select a model again.

### MCP servers were assigned, but DeepTutor shows no new tools

Run `node tools/doctor.mjs --json` and check the bridge and `mcp.json` counts, and confirm that `DEEPTUTOR_HOME` is visible to Magpie's process. DeepTutor does not watch the file; restart `deeptutor serve`, or save once in DeepTutor's MCP settings to trigger a reload.

---

## Repository layout

```text
index.mjs                     Bun plugin host: bridge file, watcher and MCP sync
deeptutor.agent.mjs           moejs Agent descriptor and connect()
lib/constants.mjs             paths, env expansion and atomic JSON writes
lib/mcp-bridge.mjs            claude mcpServers → DeepTutor servers translation
package.json                  package metadata and the Magpie declaration
install.sh / install.ps1      one-line installer (macOS/Linux · Windows)
tools/doctor.mjs              preflight: discovery, version, model and MCP checks
test/                         Agent, bridge and plugin-host tests
test/fixtures/                sample configuration files
docs/agent-plugin-contract.md the Magpie agent plugin contract
docs/deeptutor-config.md      where DeepTutor keeps its model configuration
docs/deeptutor-mcp.md         DeepTutor's MCP registry and bridge format
```

---

## License

Released under the [MIT License](LICENSE).
