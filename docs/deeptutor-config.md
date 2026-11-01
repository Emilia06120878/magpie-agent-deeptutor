# Where DeepTutor actually keeps its LLM configuration

Verified against DeepTutor **1.7.0** (`E:\DeepTutor\uv-tools\deeptutor\Lib\site-packages\deeptutor-1.7.0.dist-info`)
by reading the Python sources and by running `deeptutor config show` / `config apply`.

## TL;DR

| file | role |
|---|---|
| `<home>/setup.json` | **input file only** — consumed by `deeptutor config apply setup.json`. Nothing reads it at runtime. |
| `<home>/data/user/settings/model_catalog.json` | **the live config.** `services.llm` decides which provider/model every chat uses. |
| `<home>/data/user/settings/system.json` | ports, security guard. No LLM. |
| `<home>/data/user/settings/main.yaml` | language, logging, tools, capabilities. No LLM. |

Editing `setup.json` does **not** change a running DeepTutor. A grep for `setup.json`
across the whole installed package returns exactly one hit — the hint string
`"next_step": "deeptutor config apply setup.json"` in `deeptutor_cli/init_cmd.py:499`.

## How `<home>` is resolved

`deeptutor/runtime/home.py`:

```python
DEEPTUTOR_HOME_ENV = "DEEPTUTOR_HOME"
PACKAGE_ROOT = Path(__file__).resolve().parents[2]

def get_runtime_home(home=None):
    raw = home if home is not None else os.getenv(DEEPTUTOR_HOME_ENV)
    if raw is None or str(raw).strip() == "":
        return Path.cwd().resolve()
    return Path(raw).expanduser().resolve()

def get_runtime_data_root(home=None):
    return get_runtime_home(home) / "data"
```

Priority: explicit `--home` → `$DEEPTUTOR_HOME` → **current working directory**.
There is no `~/.deeptutor` convention anywhere in the package.

DeepTutor's own launcher (`deeptutor.cmd`) sets `DEEPTUTOR_HOME` and `cd`s into it:

```bat
set "DEEPTUTOR_HOME=E:\DeepTutor\workspace"
set "DEEPTUTOR_LOCAL_BIN=E:\DeepTutor\bin\deeptutor.exe"
set "PATH=E:\DeepTutor\bin;%PATH%"
cd /d "%DEEPTUTOR_HOME%"
"E:\DeepTutor\bin\deeptutor.exe" %*
```

So `$DEEPTUTOR_HOME/data/user/settings/model_catalog.json` is the correct, portable
target for the plugin — on Windows, macOS and Linux alike, as long as `DEEPTUTOR_HOME`
is set (which DeepTutor's launcher does).

> If `DEEPTUTOR_HOME` is unset, Magpie expands `$DEEPTUTOR_HOME` to an **empty string**
> and would end up writing `\data\user\settings\model_catalog.json` on Windows
> (`/data/...` elsewhere). Always run `node tools/doctor.mjs` before installing.

## Shape of `services.llm`

```json
{
  "services": {
    "llm": {
      "active_profile_id": "llm-profile-<uuid>",
      "active_model_id": "llm-model-<uuid>",
      "profiles": [
        {
          "id": "llm-profile-<uuid>",
          "name": "magpie",
          "binding": "custom",
          "base_url": "http://127.0.0.1:3425",
          "api_key": "...",
          "api_version": "",
          "extra_headers": {},
          "models": [
            { "id": "llm-model-<uuid>", "model": "group/workbuddyqodertrae-deepseek-flash",
              "name": "workbuddyQoderTrae-deepseek-flash" }
          ],
          "api_format": "openai_chat",
          "wire_api": "chat_completions"
        }
      ]
    }
  }
}
```

Resolution (`deeptutor/services/config/provider_runtime.py:852-884`):

```python
loaded  = _with_personal_llm_profiles(_load_catalog(catalog))
profile, model = _active_profile_and_model(loaded, catalog_service, service_name)
resolved_model = _as_str((model or {}).get("model"))
binding_hint   = canonical_provider_name(profile.get("binding"))
api_key    = profile.get("api_key")
base_url   = profile.get("base_url")
api_format = profile.get("api_format")
```

i.e. `active_profile_id` → profile → `active_model_id` → that profile's `models[]` entry →
its `model` field is what gets sent to the provider. **The model entry must exist**, or the
route resolves to nothing.

`api_format` accepts `openai_chat`; `wire_api` mirrors it as `chat_completions`.
`base_url` is stored **without** a trailing `/v1` in the working profiles.

## `deeptutor config apply` (the only place `setup.json` matters)

`deeptutor_cli/setup_config.py`:

- `prepare_profiles(config)` builds
  `{id: "llm-profile-agent-setup", name: "Agent Setup", binding: <provider>,
    base_url: <endpoint>, api_key: <key>, models: [{id: "llm-model-agent-setup",
    name: <model>, model: <model>}], api_format?: ...}` — same for `embedding` and `search`.
- `apply_setup(profiles, system)` replaces-or-appends each profile **by id** in
  `model_catalog.json`, then sets `active_profile_id` / `active_model_id`.
- `requires_key = not spec.is_local and provider != "custom" and not is_oauth`,
  yet `apply` still resolves `llm.api_key_env` / `embedding.api_key_env` and fails with
  `The environment variable named by <section>.api_key_env is empty or unset.` if unset.

So `setup.json` is a *bootstrap* file. Once DeepTutor has run, the catalog is the truth.

## What this means for the plugin

The plugin writes exactly three key paths in `model_catalog.json`:

```
services.llm.profiles            -> [ one "Magpie" profile with the selected model ]
services.llm.active_profile_id   -> "llm-profile-magpie"
services.llm.active_model_id     -> <magpie model id>
```

and declares `model: "services.llm.active_model_id"` so Magpie's own model picker stays in
sync with the same key. On disconnect Magpie restores the previous `profiles` array and the
previous active ids by value — the user's own profiles come back.

`setup.json` is deliberately left untouched: it is an input file, and rewriting it would
only create a second, stale copy of the truth.
