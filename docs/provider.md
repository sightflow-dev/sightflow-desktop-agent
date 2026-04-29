# 聊天 Provider 接入

SightFlow 桌面端把“截图分析并生成回复”的聊天能力抽象为 Provider。外部技术使用者只需要提供一份 `manifest.json` 和一个 bundle 入口文件，应用会负责下载安装、读取配置、传入聊天截图，并消费 Provider 返回的事件。

## Provider 必须提供的结构

一个 Provider 包至少包含：

```text
provider-root/
  manifest.json
  provider.bundle.js
```

`manifest.json` 用来声明 Provider 元信息、入口文件、模块格式和配置表单：

```json
{
  "apiVersion": 1,
  "id": "your-provider-id",
  "name": "Your Chat Provider",
  "version": "1.0.0",
  "entry": "provider.bundle.js",
  "moduleType": "module",
  "capabilities": ["chat"],
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": {
        "type": "password",
        "title": "接口密钥"
      },
      "model": {
        "type": "string",
        "title": "模型名称",
        "default": "your-model"
      }
    },
    "required": ["apiKey"]
  }
}
```

字段约束：

- `apiVersion` 当前固定为 `1`。
- `capabilities` 当前固定为 `["chat"]`。
- `entry` 是相对 `manifest.json` 的 bundle 文件路径。
- `moduleType` 支持 `module` 或 `commonjs`。如果省略，应用会按旧规则根据 `.mjs` / `.mts` 判断是否使用 ESM。
- `configSchema.properties` 支持 `string`、`password`、`select`、`boolean`。这些字段会显示在应用设置页，并作为 `providerConfig` 传给 Provider。

## Bundle 导出格式

ESM Provider 可以导出 `createProvider`：

```js
export function createProvider(context) {
  return {
    async *run(input) {
      yield { type: 'thinking', content: '正在分析聊天内容...' }

      const reply = await callYourModel({
        screenshot: input.screenshot,
        appType: input.appType,
        config: context.providerConfig
      })

      if (!reply) {
        yield { type: 'skip' }
        return
      }

      yield { type: 'reply_text', content: reply }
    }
  }
}
```

CommonJS Provider 可以使用：

```js
module.exports = {
  createProvider(context) {
    return {
      async *run(input) {
        yield { type: 'skip' }
      }
    }
  }
}
```

`createProvider(context)` 会收到：

- `context.providerConfig`：用户在设置页填写并保存的配置。
- `context.host.log(message)`：写入主进程日志。
- `context.host.platform`：当前运行平台。
- `context.host.appVersion`：当前应用版本。

`run(input)` 会收到：

```ts
interface ProviderInput {
  screenshot: string
  appType: 'wechat' | 'wework'
  currentContact?: string
  ocrText?: string
}
```

其中 `screenshot` 是 `data:image/...;base64,...` 格式的截图字符串。Provider 如果调用 OpenAI 兼容视觉接口，通常可以直接把它作为 `image_url.url` 传入；如果目标 API 只接受裸 base64，需要自行去掉 `base64,` 前缀。

Provider 可以返回的事件：

```ts
type ProviderEvent =
  | { type: 'thinking'; content: string }
  | { type: 'reply_text'; content: string }
  | { type: 'skip' }
  | { type: 'error'; error: string }
```

- `thinking`：展示当前处理状态。
- `reply_text`：应用会把这段文本发送到当前聊天窗口。
- `skip`：本轮不回复，例如最后一条消息是自己发的、系统消息、无法判断等。
- `error`：本轮失败，错误会展示到运行日志。

## 在应用中安装 Provider

启动应用后进入设置页，在“聊天服务配置清单地址”中填写 `manifest.json` 的地址，然后点击安装。

支持的地址格式：

```text
https://example.com/provider/manifest.json
file:///absolute/path/to/provider/manifest.json
```

注意这里填写的是 `manifest.json` 地址，不是 bundle 文件地址。应用会根据 manifest 中的 `entry` 下载或读取实际入口文件。

## Doubao Provider 示例

仓库内置示例位于：

```text
resources/providers/volcengine-ark/manifest.json
resources/providers/volcengine-ark/provider.bundle.js
```

它的接入方式是：

1. `manifest.json` 声明 `id = volcengine-ark`、`moduleType = module`、`capabilities = ["chat"]`，并暴露 `apiKey`、`model`、`systemPrompt` 三个配置项。
2. `provider.bundle.js` 导出 `createProvider(context)`，从 `context.providerConfig` 读取 API Key、模型名和系统提示词。
3. Provider 收到 `input.screenshot` 后，调用火山方舟 OpenAI 兼容接口：

```text
POST https://ark.cn-beijing.volces.com/api/v3/chat/completions
```

4. 请求中使用 `messages`，把截图作为 `image_url`，把回复要求作为文本消息传入。
5. 如果模型返回空内容或 `[SKIP]`，Provider 返回 `skip`；否则返回 `reply_text`，由桌面端继续完成发送。

本地开发时，可以在设置页填写类似下面的地址安装内置示例：

```text
file:///path/to/sightflow-dev-desktop/resources/providers/volcengine-ark/manifest.json
```

其他开发者需要把路径替换成自己机器上的仓库绝对路径，或者把 `manifest.json` 和 bundle 发布到可访问的 HTTPS 地址。
