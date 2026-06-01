---
name: sightflow_agent
description: >
  控制 SightFlow 桌面智能体的启动、暂停和状态查询。
  当用户需要启动 / 暂停 SightFlow 消息自动回复智能体，或查询其运行状态时使用此 skill。
  智能体应用需要提前启动并保持运行。
metadata: { 'openclaw': { 'emoji': '👁️', 'requires': { 'os': ['macos', 'windows'] } } }
---

# SightFlow Agent 控制 Skill

本 skill 通过本地 HTTP API 控制 SightFlow 桌面智能体。API 仅监听 `127.0.0.1:12680`。

## 前置条件

- SightFlow 桌面客户端必须已经启动并运行
- 如需通过 HTTP 启动 / 暂停，请在启动客户端前设置 `SIGHTFLOW_SKILL_TOKEN`
- 如需运行非内置 Provider，请在确认来源可信后设置 `SIGHTFLOW_ALLOW_CUSTOM_PROVIDER_CODE=1`
- 非内置 Provider 会在独立 utility process 中运行，但仍不等于完整系统沙箱
- 已在「设置」中填写视觉接口密钥 (Vision API Key)
- 已安装并配置好聊天 Provider（如火山方舟）

## API 端点

### 查询状态

```bash
curl -s http://127.0.0.1:12680/skill/status
```

**响应：**

- `{ "ok": true, "status": "running" }` — 智能体正在运行
- `{ "ok": true, "status": "stopped" }` — 智能体已停止

### 启动智能体

```bash
curl -s -X POST \
  -H "x-sightflow-token: $SIGHTFLOW_SKILL_TOKEN" \
  http://127.0.0.1:12680/skill/start
```

**响应：**

- `{ "ok": true }` — 启动成功
- `{ "ok": false, "error": "<error_code>", "message": "<details>" }` — 启动失败

**错误码：**
| error_code | 含义 |
|---|---|
| `no_vision_key` | 未配置视觉接口密钥，请先在设置中填写 |
| `no_provider` | 未安装聊天 Provider，请先安装 |
| `missing_required_field` | Provider 必填配置缺失（如 apiKey） |
| `engine_failed` | 引擎启动失败 |
| `already_running` | 智能体已在运行中 |
| `operation_in_progress` | 有其他启动 / 暂停操作正在执行 |
| `skill_token_not_configured` | 未设置 `SIGHTFLOW_SKILL_TOKEN`，HTTP 启停被禁用 |
| `unauthorized` | 缺少或传入了错误的 `x-sightflow-token` |

### 暂停智能体

```bash
curl -s -X POST \
  -H "x-sightflow-token: $SIGHTFLOW_SKILL_TOKEN" \
  http://127.0.0.1:12680/skill/pause
```

**响应：**

- `{ "ok": true }` — 暂停成功
- `{ "ok": false, "error": "<error_code>", "message": "<details>" }` — 暂停失败

**错误码：**
| error_code | 含义 |
|---|---|
| `not_running` | 智能体未在运行 |
| `operation_in_progress` | 有其他启动 / 暂停操作正在执行 |
| `pause_failed` | 内部停止流程异常 |
| `skill_token_not_configured` | 未设置 `SIGHTFLOW_SKILL_TOKEN`，HTTP 启停被禁用 |
| `unauthorized` | 缺少或传入了错误的 `x-sightflow-token` |

## 使用流程

1. **先查询状态**确认应用是否在线：调用 `GET /skill/status`
2. 根据需要调用 `POST /skill/start` 或 `POST /skill/pause`
3. 操作后再次查询状态确认结果

## 注意事项

- 所有请求都是本地请求（127.0.0.1），无需网络
- 服务端会校验 `Host` 必须是 `127.0.0.1` / `localhost` / `::1`
- 启动 / 暂停操作有并发保护，同一时间只能执行一个操作
- 远程启动 / 暂停后，桌面客户端 UI 会同步切换到对应状态
- 如果返回 `no_vision_key` / `no_provider` / `missing_required_field`，需要用户在桌面客户端「设置」中补全配置
- 端口 12680 如果被占用，应用会 fallback 到 12681
