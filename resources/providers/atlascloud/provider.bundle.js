/* eslint-disable @typescript-eslint/explicit-function-return-type */
const DEFAULT_MODEL = 'qwen/qwen3.5-flash'
const DEFAULT_BASE_URL = 'https://api.atlascloud.ai/v1'
const DEFAULT_PROMPT = `你是一个桌面聊天自动回复助手。你会收到一张聊天窗口截图。

## 你的任务
分析截图中的聊天内容，生成合适的回复。

## 规则
1. 只输出回复文字，不要解释、不要添加多余内容
2. 防自我循环：仔细观察截图。如果最后一条消息明显是"我"发送的，必须输出 [SKIP]
3. 如果最新消息是系统消息、群公告、红包、转账等非对话消息，输出 [SKIP]
4. 如果无法判断是否需要回复，输出 [SKIP]
5. 回复要自然、口语化，像真人对话`

export const manifest = {
  id: 'atlascloud',
  apiVersion: 1
}

export function createProvider(context) {
  const providerConfig = context && context.providerConfig ? context.providerConfig : {}

  return {
    async *run(input) {
      if (!input || !input.screenshot) {
        yield { type: 'skip' }
        return
      }

      const apiKey = providerConfig.apiKey
      if (!apiKey) {
        yield { type: 'error', error: 'Atlas Cloud 缺少接口密钥' }
        return
      }

      const memorySection = buildMemorySection(input.memoryCards)
      yield {
        type: 'thinking',
        content: memorySection
          ? `正在通过 Atlas Cloud 分析聊天内容（已加载 ${input.memoryCards.length} 条团队经验）...`
          : '正在通过 Atlas Cloud 分析聊天内容...'
      }

      try {
        const reply = await requestReply({
          screenshot: input.screenshot,
          apiKey,
          model: providerConfig.model || DEFAULT_MODEL,
          systemPrompt: (providerConfig.systemPrompt || DEFAULT_PROMPT) + memorySection
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
        yield { type: 'error', error: message || 'Atlas Cloud 调用失败' }
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
          { type: 'text', text: '请根据截图中聊天窗口的最新消息进行回复。' }
        ]
      }
    ],
    stream: false
  }

  const response = await fetch(`${DEFAULT_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const details = await readErrorDetails(response)
    throw new Error(
      `Atlas Cloud API request failed: ${response.status} ${response.statusText}${details}`
    )
  }

  const json = await response.json()
  return json && json.choices && json.choices[0] && json.choices[0].message
    ? json.choices[0].message.content || ''
    : ''
}

async function readErrorDetails(response) {
  try {
    const text = await response.text()
    return text ? ` - ${text.slice(0, 300)}` : ''
  } catch {
    return ''
  }
}

function buildMemorySection(memoryCards) {
  if (!Array.isArray(memoryCards) || memoryCards.length === 0) {
    return ''
  }
  const lines = memoryCards.map((card, index) => {
    const rationale = card.rationale ? `（原因：${card.rationale}）` : ''
    return `${index + 1}. 【${card.scenario}】${card.guidance}${rationale}`
  })
  return `\n\n## 团队经验（来自工作记忆，优先遵循）\n${lines.join('\n')}`
}

function normalizeImageUrl(screenshot) {
  const rawBase64 = stripBase64Prefix(screenshot)
  if (rawBase64.startsWith('http')) {
    return rawBase64
  }
  return `data:image/png;base64,${rawBase64}`
}

function stripBase64Prefix(base64) {
  const idx = String(base64).indexOf('base64,')
  return idx !== -1 ? String(base64).slice(idx + 'base64,'.length) : String(base64)
}
