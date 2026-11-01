# Magpie agent plugin contract (as of Magpie 0.1.25xx)

Everything here was verified against Magpie's own docs (`https://usemagpie.ai/docs/plugins`)
and by loading probe plugins into a portable Magpie instance.

## 1. How Magpie discovers an agent

A package declares itself in `package.json`:

```json
{
  "type": "module",
  "magpie": { "agent": "./deeptutor.agent.mjs" }
}
```

Either the `magpie.agent` field, or a file named `*.agent.js` / `*.agent.mjs`.
`main` / `exports` are **not** used for agent discovery (they are used by the
plugin loader to decide whether the package is loadable at all — a package with
neither `main`/`exports`/`index` and only `magpie.agent` still loads, but a
`package.json` with a **UTF-8 BOM** makes the loader fail with
`... isn't an OpenCode or magpie plugin: its package names no file to load`).

## 2. The `agent` export

```js
export const agent = { id, name, icon?, bin, dir?, config, format?, model?, prefix?, ua?, notice?, library? };
export function connect(input) { /* returns key-path -> value pairs */ }
```

| field | meaning |
|---|---|
| `id` | lowercase letters, digits, `.`, `_`, `-`. Must not collide with a built-in agent (`codex`, `claude`, …) — collision is rejected at load time |
| `name` | display name in the Agent page (defaults to `id`) |
| `config` | **the single file** Magpie edits. `~` and `$VAR` are expanded. **Must be a string** — an array of candidates is rejected: `agent: json: cannot unmarshal array into Go struct field Desc.config of type string` |
| `format` | `json` \| `yaml` \| `env`; only needed when the file name does not reveal it |
| `model` | dotted key path inside the file holding the selected model id (e.g. `llm.model`). Omit when the agent keeps its own model picker — then Magpie shows no model selector and calls `connect()` **without** `model` |
| `prefix` | string prepended to the magpie model id before writing (LiteLLM style, e.g. `openai/`) |
| `bin`, `dir` | a command that must be on `PATH` and/or a config dir — used to decide "installed / not detected". A plugin must **never** create files just to be detected |
| `ua` | substrings of the User-Agent used to attribute usage to this agent |
| `notice` | shown after a model switch (e.g. "restart the app") |
| `library` | `{ instructions, mcp, mcpFormat, skills }` |

`connect(input)` receives:

```js
{
  gateway: { url, v1 /* ends with /v1 */, key /* per-agent key, magpie-<id> */ },
  model:   { id, name, context, output, images, efforts, native_endpoints, pricing },
  models:  [ /* every model Magpie exposes for this agent, same shape */ ],
  agent:   { id, config }
}
```

and returns an object of **key path → value** pairs, which Magpie merges **in place**:
existing keys and comments in the file survive; only the written paths change.

## 3. Write / restore semantics

- Every returned key path is written individually. Missing intermediate objects are created
  (`deep.nest.key` creates three levels).
- **Arrays are leaves**: returning `services.llm.profiles` replaces the whole array, it is not
  merged element-wise.
- Before the first write of a key, Magpie backs up its original value **by type**.
- Disconnecting (`magpie <agent> default`) or switching back to the agent's own model
  restores each backed-up value; keys that did not exist before are deleted.
- The file is never overwritten as a whole by the plugin API.
- "Is it connected?" is decided by *reading the file back* — not by any marker comment.
  Removing a `# magpie` comment from the YAML does **not** make Magpie forget the agent.

## 4. Runtime limits (moejs)

Agent plugins run inside Magpie's own process in a **moejs** sandbox:

- available globals are pure ECMAScript plus `console`, `atob`/`btoa`,
  `TextEncoder`/`TextDecoder`, `structuredClone`, `queueMicrotask`;
- **no** `process`, `require`, `fetch`, `fs`, `Bun`, `setTimeout`, `setInterval`;
- `import` only of files inside the plugin directory — no `node_modules`;
- `console.log` goes to Magpie's log, prefixed `agent plugin <path>: `, max 60 lines/min;
- module load and each `connect()` call have a 1 s budget. A load error or a throwing
  `connect()` is reported on the plugin row in the Agent page and **nothing is written**.

Consequences for plugin design: an agent plugin cannot probe the filesystem, cannot read
`process.env`, cannot run `deeptutor --version`, and cannot create directories. It is a
declarative mapping plus a pure function. Anything that needs the filesystem (locating an
installation, version checks, backups) has to live in a normal Node/Bun tool shipped next
to the plugin (see `tools/doctor.mjs`), not in `connect()`.

## 5. Testing without touching a real install

```sh
sb=$(mktemp -d)
env HOME=$sb XDG_CONFIG_HOME=$sb/.config XDG_CACHE_HOME=$sb/.cache \
    MAGPIE_ADDR=127.0.0.1:3499 magpie serve
```

On Windows, use a portable instance instead: put an empty `.portable` file next to
`magpie.exe` and set `MAGPIE_ADDR` / `DEEPTUTOR_HOME` in that process' environment.
