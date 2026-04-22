// src/core/ai-client.ts
// AI 客户端 — 统一封装所有大模型调用
//
// 使用火山引擎 Ark OpenAI 兼容 /chat/completions 端点 + doubao-seed-2-0-lite
// 两种用途：
//   1. 聊天回复：截图 → AI 分析 → 回复文字
//   2. VLM 视觉检测：截图 → AI 分析 → bbox/point 坐标

export interface AIClientConfig {
  apiKey: string
  model: string
  baseURL: string
  systemPrompt: string
}

const DEFAULT_MODEL = 'doubao-seed-2-0-lite-260215'
const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

const REPLY_SYSTEM_PROMPT = `你是一个微信自动回复助手。你会收到一张微信/企业微信的聊天窗口截图。

## 你的任务
分析截图中的聊天内容，生成合适的回复。

## 规则
1. 只输出回复文字，不要解释、不要添加多余内容
2. **防自我循环**：仔细观察截图。聊天窗口中，右侧的气泡是"我"发送的。如果最后一条消息是右侧气泡（即"我"自己发送的），必须输出 [SKIP]
3. 如果最新消息是系统消息、群公告、红包、转账等非对话消息，输出 [SKIP]
4. 如果无法判断是否需要回复，输出 [SKIP]
5. 回复要自然、口语化，像真人对话`

export class AIClient {
  private config: AIClientConfig

  constructor(config: Partial<AIClientConfig> & { apiKey: string }) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || DEFAULT_MODEL,
      baseURL: config.baseURL || DEFAULT_BASE_URL,
      systemPrompt: config.systemPrompt || REPLY_SYSTEM_PROMPT
    }
  }

  /**
   * 发送截图给 AI，获取聊天回复
   */
  async getReply(screenshotBase64: string): Promise<string | null> {
    const startTime = Date.now()
    try {
      console.log('[AIClient] getReply 开始...')
      const replyText = await this.callVision(
        this.config.systemPrompt,
        '请根据截图中微信聊天窗口的最新消息进行回复。',
        screenshotBase64
      )

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[AIClient] getReply 完成 (${elapsed}s):`, replyText?.slice(0, 100))

      if (!replyText || replyText.trim() === '[SKIP]') {
        return null
      }

      return replyText.trim()
    } catch (error: any) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.error(`[AIClient] 聊天回复失败 (${elapsed}s):`, error?.message || error)
      throw error
    }
  }

  /**
   * VLM 视觉检测 — 发送截图 + prompt，获取 bbox/point 文本
   * 供 vision-utils.ts 调用
   */
  async detectVision(prompt: string, screenshotBase64: string): Promise<string> {
    return await this.callVision(
      '你是一个视觉分析专家。请严格按照用户要求的格式输出检测结果。',
      prompt,
      screenshotBase64
    )
  }

  /**
   * 纯文本调用（不带图片）— 用于 testConnection 等
   */
  async callText(userMessage: string): Promise<string> {
    const data = await this.callAPI([
      { role: 'user', content: userMessage }
    ])
    return this.extractText(data)
  }

  /**
   * 测试 API 连接
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.callText('你好，请回复"连接成功"。')
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  }

  updateConfig(config: Partial<AIClientConfig>): void {
    Object.assign(this.config, config)
  }

  getApiKey(): string {
    return this.config.apiKey
  }

  // ── 内部方法 ──

  /**
   * 视觉调用：system prompt + 用户文本 + 图片
   */
  private async callVision(
    systemPrompt: string,
    userText: string,
    imageBase64: string
  ): Promise<string> {
    const rawBase64 = this.stripBase64Prefix(imageBase64)
    const imageUrl = rawBase64.startsWith('http')
      ? rawBase64
      : `data:image/png;base64,${rawBase64}`

    const data = await this.callAPI([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: userText }
        ]
      }
    ])

    return this.extractText(data)
  }

  /**
   * 底层 HTTP 调用 — OpenAI 兼容 /chat/completions 端点
   * thinking 字段是火山方舟对标 OpenAI Responses API 的扩展参数，
   * 在非火山供应商上会被忽略，放在这里不影响兼容性
   */
  private async callAPI(messages: any[]): Promise<any> {
    const url = `${this.config.baseURL}/chat/completions`
    const TIMEOUT_MS = 30_000 // 30 秒超时
    const callStart = Date.now()

    // 计算 payload 大小（粗略，不重复序列化）
    const bodyStr = JSON.stringify({
      model: this.config.model,
      messages,
      thinking: { type: 'disabled' },
      stream: false
    })
    const bodySizeKB = (bodyStr.length / 1024).toFixed(0)
    console.log(
      `[AIClient] callAPI 开始 | model=${this.config.model} | payload=${bodySizeKB}KB | timeout=${TIMEOUT_MS / 1000}s`
    )

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: bodyStr,
        signal: controller.signal
      })

      const fetchElapsed = ((Date.now() - callStart) / 1000).toFixed(1)
      console.log(`[AIClient] 收到响应 status=${response.status} (${fetchElapsed}s)`)

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[AIClient] API 错误: ${response.status}`, errorText)
        throw new Error(`API request failed: ${response.status} - ${errorText.slice(0, 200)}`)
      }

      const json = await response.json()
      const totalElapsed = ((Date.now() - callStart) / 1000).toFixed(1)
      console.log(`[AIClient] 解析完成 (${totalElapsed}s)`)
      return json
    } catch (error: any) {
      const elapsed = ((Date.now() - callStart) / 1000).toFixed(1)
      if (error?.name === 'AbortError') {
        console.error(`[AIClient] ⏱ 超时！已等待 ${elapsed}s，上限 ${TIMEOUT_MS / 1000}s`)
        throw new Error(`AI API 请求超时 (${TIMEOUT_MS / 1000}s)`)
      }
      console.error(`[AIClient] 请求异常 (${elapsed}s):`, error?.message)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 从 OpenAI 兼容 /chat/completions 返回值中提取文本
   * 格式: { choices: [{ message: { role, content: string } }] }
   */
  private extractText(responseData: any): string {
    const content = responseData?.choices?.[0]?.message?.content
    if (typeof content === 'string' && content.length > 0) {
      return content
    }
    console.warn('[AIClient] 无法解析回复格式:', JSON.stringify(responseData).slice(0, 500))
    return ''
  }

  private stripBase64Prefix(base64: string): string {
    const idx = base64.indexOf('base64,')
    return idx !== -1 ? base64.slice(idx + 'base64,'.length) : base64
  }
}
