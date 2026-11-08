# DeepTutor MCP registry and the Magpie Library bridge

Verified against DeepTutor **1.7.0** and Magpie **0.1.2332**.

## Why there is a bridge file

Magpie's Agent plugin contract lets `agent.library` name one MCP file in one of
the formats Magpie knows how to write. `mcpFormat: "claude"` writes a Claude-shaped
object:

```json
{
  "mcpServers": {
    "web": { "type": "http", "url": "http://127.0.0.1:3425/mcp/magpie/web" },
    "tools": { "type": "stdio", "command": "node", "args": ["tool.js"] }
  }
}
```

DeepTutor's deployment-wide MCP client registry is a different object and lives
inside the DeepTutor runtime home:

```text
$DEEPTUTOR_HOME/data/user/settings/mcp.json
```

```json
{
  "servers": {
    "name": {
      "type": "stdio" | "sse" | "streamableHttp",
      "command": "",
      "args": [],
      "env": {},
      "cwd": "",
      "url": "",
      "headers": {},
      "tool_timeout": 30,
      "enabled_tools": ["*"],
      "disabled_tools": [],
      "enabled": true,
      "allow_private_network": false,
      "auth": "",
      "catalog_entry": ""
    }
  }
}
```

The relevant DeepTutor source is:

- `deeptutor/services/mcp/config.py`: `MCPServerConfig`, `MCPConfig`, `mcp_config_path()`
  and `save_mcp_config()`.
- `deeptutor/multi_user/paths.py`: `get_admin_path_service()`.
- `deeptutor/services/path_service.py`: `get_settings_dir()` returns `<home>/data/user/settings`.
- `deeptutor/services/mcp/manager.py`: `ensure_started()`, `reload()` and `_sync_to_config()`.
- `deeptutor/api/routers/mcp_settings.py`: writes and reloads the registry through the API.

Magpie cannot write DeepTutor's `servers` object directly with any supported
`mcpFormat`: the key name, transport spellings and schema differ. The plugin
therefore declares a Magpie-owned bridge and translates it in its Bun runtime:

```text
Magpie Library (assign MCP servers to DeepTutor)
  → ~/.config/magpie/deeptutor-mcp-bridge.json       (mcpServers, Claude format)
  → index.mjs watches the bridge
  → $DEEPTUTOR_HOME/data/user/settings/mcp.json      (servers, DeepTutor format)
```

## Translation rules

| Magpie bridge | DeepTutor `servers` entry |
| --- | --- |
| `type: "http"` with URL | `type: "streamableHttp"`, URL and string headers preserved |
| `type: "sse"` with URL | `type: "sse"`, URL and string headers preserved |
| `type: "stdio"` with command | `type: "stdio"`, command, string args and string env preserved |
| `disabled: true` | `enabled: false` |
| server name `name` | `magpie-deeptutor-name` |

The bridge `type` must be exactly `http`, `sse` or `stdio`. A URL alone is not
accepted as a transport, because Magpie's `claude` format writes `type` on every
entry it owns.

Entries with an unsupported name, missing command, invalid URL or unsupported
type are reported as errors and skipped. Valid entries are still translated, and
entries that disappeared from the Library are still removed. A bad entry that
remains selected keeps its last valid DeepTutor definition instead of being
deleted; errors are returned by the sync and recorded in state.

Only names beginning with `magpie-deeptutor-` are owned by the plugin. User-added
DeepTutor servers are preserved byte-for-byte at the JSON value level. Settings
that DeepTutor owns on a synced entry (for example `tool_timeout`,
`enabled_tools`, `disabled_tools`, `allow_private_network`, `auth` and
`catalog_entry`) are also preserved when the same Library entry is rewritten.
Unselecting an MCP server in the Library removes only its owned entry.

`DEEPTUTOR_HOME` must be set in Magpie's process environment, not just in the
terminal or DeepTutor's own launcher. When it is not, the plugin host refuses to
sync instead of writing a root-relative path. This is the same environment
variable the existing model-catalog config uses. On Windows, set a user-level
environment variable and restart Magpie (and the desktop app, if it launches
Magpie) before installing the plugin; `tools/doctor.mjs --json` can find an
installation through the `deeptutor` binary even when Magpie will not inherit
that setting.

## Live reload

DeepTutor's connection manager loads `mcp.json` at startup and reloads it when
its settings API saves a server. It does not watch the file by itself. The
plugin writes the registry atomically, but a running DeepTutor may keep its
existing MCP sessions until an administrator saves a server in Settings or the
service restarts. Restarting `deeptutor serve` is the most reliable way to pick
up Library changes.

## Diagnostics

```bash
node tools/doctor.mjs --json
```

The report includes the bridge path, its selected server count, the resolved
`mcp.json` path, the number of synced/user-owned entries, and the state file.
It does not modify either file.
