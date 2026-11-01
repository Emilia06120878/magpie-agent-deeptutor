[English](README.en.md) | [简体中文](README.md)

# DeepTutor · Magpie Agent

Lets DeepTutor use every model and routing group configured in Magpie. Magpie's Agent page does not know DeepTutor by default; once this plugin is installed it appears in the list.
Supports **Windows / macOS / Linux**, target **DeepTutor ≥ 1.7.0**.

---

## Features

- **Every model in one write**: the models and routing groups configured in Magpie are written into DeepTutor in a single pass, and are switched afterwards from DeepTutor's own model list without returning to Magpie.
- **The same configuration DeepTutor reads**: writes `model_catalog.json`, the file DeepTutor resolves its LLM route from. DeepTutor's source and startup are untouched.
- **Restored on disconnect**: original values are backed up per key, and disconnecting or uninstalling restores the configuration as it was before, leaving existing profiles intact.
- **Nothing else touched**: `embedding`, `search` and `setup.json` are left alone.
- **Cross-platform**: one set of paths and commands across Windows, macOS and Linux.

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

Or add the repository from Magpie → **Plugins**:

```text
github:Emilia06120878/magpie-agent-deeptutor
```

Or with the Magpie CLI: `magpie plugin add github:Emilia06120878/magpie-agent-deeptutor`

---

## Install and first run

### Prerequisites

- **Magpie** installed, with the gateway answering on `127.0.0.1:3425`.
- **DeepTutor 1.7.0 or newer** installed, with `DEEPTUTOR_HOME` pointing at its runtime directory. DeepTutor's own launcher sets that variable.
- At least one model or routing group configured in Magpie.

### Steps

1. **Run the preflight check**: `node tools/doctor.mjs`. It discovers the DeepTutor directory, validates the version and the catalog, and prints the `DEEPTUTOR_HOME` value to export.
2. **Install the plugin**: run the one-line installer above, or `magpie plugin add github:Emilia06120878/magpie-agent-deeptutor`. Then `magpie ls` should list DeepTutor.
3. **Select a model in Magpie**: Agents page → **DeepTutor** → model.
4. **Switch models in DeepTutor**: open DeepTutor's own settings; the `Magpie` profile already lists every model.

> DeepTutor resolves its model route when a chat starts, so a new chat is enough. For a long-lived `deeptutor serve` process, restarting once is safer. The plugin neither starts nor stops that service.

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
| **Run the unit tests** | `node test/run-tests.mjs` |

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

- Set `DEEPTUTOR_HOME` before installing. When it is unset the path resolves to the drive root (`\data\user\settings\model_catalog.json` on Windows); `tools/doctor.mjs` catches this beforehand.
- DeepTutor 1.7.0 or newer is required. On older versions the agent appears in the list but cannot be taken over, and `tools/doctor.mjs` reports the reason.
- A model switch takes effect on the next chat; for a long-lived `deeptutor serve` process, restarting once is safer.

---

## Troubleshooting

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

---

## Repository layout

```text
deeptutor.agent.mjs           plugin entry point
package.json                  package metadata and the Magpie declaration
install.sh / install.ps1      one-line installer (macOS/Linux · Windows)
tools/doctor.mjs              preflight: discovery, version check, catalog validation
test/run-tests.mjs            connect() tests, 30 assertions
test/fixtures/                sample configuration files
docs/agent-plugin-contract.md the Magpie agent plugin contract
docs/deeptutor-config.md      where DeepTutor keeps its model configuration
```

---

## License

Released under the [MIT License](LICENSE).
