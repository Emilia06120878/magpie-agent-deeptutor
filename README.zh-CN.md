[English](README.md) | [简体中文](README.zh-CN.md)

# DeepTutor · Magpie Agent

让 DeepTutor 直接使用 Magpie 中配置的全部模型与路由组。Magpie 的 Agent 页原本不认识 DeepTutor，装上这个插件之后它出现在列表里。
支持 **Windows / macOS / Linux**，目标版本 **DeepTutor ≥ 1.7.0**。

---

## 特性

- **全部模型一次接入**：Magpie 中配置的模型与路由组会一次性写入 DeepTutor，之后在 DeepTutor 自己的模型列表里可直接切换，不必回到 Magpie 重新配置。
- **与 DeepTutor 官方配置一致**：写入的是 DeepTutor 运行时真正读取的 `model_catalog.json`，不改 DeepTutor 源码，也不改它的启动方式。
- **断开即还原**：连接时逐键备份原值，断开或卸载后恢复为写入前的配置，不影响原有的 profile。
- **不动其它配置**：`embedding`、`search`、`setup.json` 均不修改。
- **跨平台**：Windows、macOS、Linux 使用同一套配置路径与命令。

---

### 安装方式

在 Magpie → **Plugins** 中添加仓库地址：

```text
github:Emilia06120878/magpie-agent-deeptutor
```

---

## 安装与快速上手

### 前置条件

- 本机已安装 **Magpie**，网关在 `127.0.0.1:3425` 正常响应。
- 本机已安装 **DeepTutor 1.7.0 及以上**，`DEEPTUTOR_HOME` 指向它的运行目录（DeepTutor 自己的启动脚本会设置这个变量）。
- Magpie 中至少已添加一个可用模型或路由组。

### 步骤

1. **运行体检**：`node tools/doctor.mjs`。它会探测 DeepTutor 目录、校验版本与配置，并打印应当设置的 `DEEPTUTOR_HOME`。
2. **安装插件**：`magpie plugin add <路径>`，随后 `magpie ls` 应能列出 DeepTutor。
3. **在 Magpie 中选择模型**：Agents 页面 → **DeepTutor** → 模型。
4. **在 DeepTutor 中切换模型**：打开 DeepTutor 自己的设置，`Magpie` profile 下已列出全部模型，直接切换即可。

> DeepTutor 在对话开始时解析模型路由，新开一个对话即可生效；`deeptutor serve` 长期运行时重启一次更稳妥。插件不启动也不停止该服务。

---

## 常用管理命令

| 操作 | 命令 |
| :--- | :--- |
| **安装前体检** | `node tools/doctor.mjs` |
| **安装插件** | `magpie plugin add <路径>` |
| **查看已检测到的 agent** | `magpie ls` |
| **查看 DeepTutor 接管状态** | `magpie deeptutor` |
| **断开并还原配置** | `magpie deeptutor default` |
| **删除插件** | `magpie plugin rm magpie-agent-deeptutor` |
| **运行单元测试** | `node test/run-tests.mjs` |

---

## 架构与工作流程

```text
Magpie Agent 页
    │  选中模型
    ▼
Magpie Agent 插件 deeptutor.agent.mjs
    │  接收 gateway 与模型列表
    ▼
写入三个键路径
    $DEEPTUTOR_HOME/data/user/settings/model_catalog.json
      services.llm.profiles[]          ← Magpie 提供的全部模型
      services.llm.active_profile_id   ← llm-profile-magpie
      services.llm.active_model_id     ← Magpie 中选中的那个
    │
    ▼
DeepTutor 对话开始
    │  active_profile_id → profile → active_model_id
    ▼
本地 Magpie 网关 http://127.0.0.1:3425
    ▼
模型提供商
```

写入后的 `services.llm` 结构（节选）：

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

## 注意事项

- 安装前请设置 `DEEPTUTOR_HOME`。未设置时路径会解析到磁盘根目录（Windows 下为 `\data\user\settings\model_catalog.json`），`tools/doctor.mjs` 会提前发现这种情况。
- 版本要求 DeepTutor 1.7.0 及以上。低于该版本时插件会出现在列表中但无法接管，`tools/doctor.mjs` 会说明原因。
- 切换模型后需要新开对话才会生效；`deeptutor serve` 长期运行时重启一次更稳妥。

---

## 常见问题

### 对话时报 `Invalid port: ':1]'`

这是代理环境变量的问题，与插件无关。`NO_PROXY` 里如果同时写了 `::1` 和 `[::1]`，httpx 会把 `[::1]` 展开成 `all://*[::1]` 并解析失败，DeepTutor 在建立模型连接时就会抛出：

```
httpx.InvalidURL: Invalid port: ':1]'
```

把 `NO_PROXY` 里的 `[::1]` 去掉，只保留 `::1` 即可：

```text
NO_PROXY=10.69.24.25,198.18.0.1,.local,localhost,127.0.0.1,::1
```

### 切换模型后没有生效

DeepTutor 在对话开始时解析模型路由。新开一个对话即可；`deeptutor serve` 长期运行时重启一次更稳妥。

### 接管后模型列表是空的

Magpie 中还没有配置可用模型。先在 Magpie 里添加账号或模型，再重新选择一次。

---

## 仓库结构

```text
deeptutor.agent.mjs           插件入口
package.json                  包信息与 Magpie 插件声明
tools/doctor.mjs              安装前检查：目录探测、版本校验、配置校验
test/run-tests.mjs            connect() 测试，30 条断言
test/fixtures/                示例配置文件
docs/agent-plugin-contract.md Magpie Agent 插件契约
docs/deeptutor-config.md      DeepTutor 的模型配置位置
```

---

## 开源协议

本项目遵循 [MIT License](LICENSE)。
