// src/core/ai-client.ts
// AI 客户端 — 统一封装所有大模型调用
//
// 使用火山引擎 Ark /responses 端点 + doubao-seed-2-0-lite
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
      {
        role: 'user',
        content: [{ type: 'input_text', text: userMessage }]
      }
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

    const data = await this.callAPI([
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }]
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_image',
            image_url: rawBase64.startsWith('http')
              ? rawBase64
              : `data:image/png;base64,${rawBase64}`
          },
          {
            type: 'input_text',
            text: userText
          }
        ]
      }
    ])

    return this.extractText(data)
  }

  /**
   * 底层 HTTP 调用 — 火山引擎 Ark /responses 端点
   */
  private async callAPI(input: any[]): Promise<any> {
    const url = `${this.config.baseURL}/responses`
    const TIMEOUT_MS = 30_000 // 30 秒超时

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.model,
          input
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[AIClient] API 错误: ${response.status}`, errorText)
        throw new Error(`API request failed: ${response.status} - ${errorText.slice(0, 200)}`)
      }

      return await response.json()
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`AI API 请求超时 (${TIMEOUT_MS / 1000}s)`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 从火山 /responses 返回值中提取文本
   *
   * 火山引擎 /responses 端点实际返回格式:
   * {
   *   output: [
   *     { type: "reasoning", summary: [...], status: "completed" },
   *     { type: "message", role: "assistant", content: [{ type: "output_text", text: "..." }], status: "completed" }
   *   ]
   * }
   */
  private extractText(responseData: any): string {
    if (Array.isArray(responseData?.output)) {
      const texts: string[] = []

      for (const item of responseData.output) {
        // 1. 顶层直接是 output_text / text
        if (item.type === 'output_text' || item.type === 'text') {
          if (item.text) texts.push(item.text)
          else if (typeof item.content === 'string') texts.push(item.content)
        }
        // 2. type=message，文本嵌套在 content 数组中
        else if (item.type === 'message' && Array.isArray(item.content)) {
          for (const block of item.content) {
            if ((block.type === 'output_text' || block.type === 'text') && block.text) {
              texts.push(block.text)
            }
          }
        }
        // 3. 忽略 reasoning 等其他类型
      }

      if (texts.length > 0) {
        return texts.join('')
      }
    }
    // fallback: output.content 或 output 字符串
    if (responseData?.output?.content) {
      return responseData.output.content
    }
    if (typeof responseData?.output === 'string') {
      return responseData.output
    }
    // OpenAI /chat/completions 兼容格式
    if (responseData?.choices?.[0]?.message?.content) {
      return responseData.choices[0].message.content
    }
    console.warn('[AIClient] 无法解析回复格式:', JSON.stringify(responseData).slice(0, 500))
    return ''
  }

  private stripBase64Prefix(base64: string): string {
    const idx = base64.indexOf('base64,')
    return idx !== -1 ? base64.slice(idx + 'base64,'.length) : base64
  }
}
