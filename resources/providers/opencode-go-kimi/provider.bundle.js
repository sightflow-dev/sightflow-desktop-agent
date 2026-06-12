const BASE_URL = 'https://opencode.ai/zen/go/v1'
const DEFAULT_MODEL = 'kimi-k2.5'
const DEFAULT_PROMPT = `你是一个微信自动回复助手。你会收到一张微信/企业微信的聊天窗口截图。

## 你的任务
分析截图中的聊天内容，生成合适的回复。

## 规则
1. 只输出回复文字，不要解释、不要添加多余内容
2. 防自我循环：仔细观察截图。聊天窗口中，右侧的气泡是"我"发送的。如果最后一条消息是右侧气泡，必须输出 [SKIP]
3. 如果最新消息是系统消息、群公告、红包、转账等非对话消息，输出 [SKIP]
4. 如果无法判断是否需要回复，输出 [SKIP]
5. 回复要自然、口语化，像真人对话`

export const manifest = {
  id: 'opencode-go-kimi',
  apiVersion: 1
}

export function createProvider(context) {
  const config = context && context.providerConfig ? context.providerConfig : {}

  return {
    async *run(input) {
      if (!input || !input.screenshot) {
        yield { type: 'skip' }
        return
      }

      const apiKey = config.apiKey
      if (!apiKey) {
        yield { type: 'error', error: '缺少 OpenCode Go API Key' }
        return
      }

      yield { type: 'thinking', content: '正在分析聊天内容...' }

      try {
        const reply = await requestReply({
          screenshot: input.screenshot,
          apiKey,
          model: config.model || DEFAULT_MODEL,
          systemPrompt: config.systemPrompt || DEFAULT_PROMPT
        })

        if (!reply || reply.trim() === '[SKIP]') {
          yield { type: 'skip' }
          return
        }

        yield { type: 'reply_text', content: reply.trim() }
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        if (context && context.host && typeof context.host.log === 'function') {
          context.host.log(`provider error: ${message}`)
        }
        yield { type: 'error', error: message || '聊天服务调用失败' }
      }
    }
  }
}

async function requestReply({ screenshot, apiKey, model, systemPrompt }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: normalizeImageUrl(screenshot) } },
          { type: 'text', text: '请根据截图中微信聊天窗口的最新消息进行回复。' }
        ]
      }
    ],
    stream: false,
    max_tokens: 1024
  }

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`API request failed: ${response.status} ${response.statusText}${errText ? ' — ' + errText.slice(0, 200) : ''}`)
  }

  const json = await response.json()
  const msg = json && json.choices && json.choices[0] && json.choices[0].message

  // 优先取 content，如果空则取 reasoning_content
  return msg
    ? (msg.content || msg.reasoning_content || '')
    : ''
}

function normalizeImageUrl(screenshot) {
  const raw = stripBase64Prefix(screenshot)
  if (raw.startsWith('http')) return raw
  return `data:image/png;base64,${raw}`
}

function stripBase64Prefix(base64) {
  const idx = String(base64).indexOf('base64,')
  return idx !== -1 ? String(base64).slice(idx + 7) : String(base64)
}
