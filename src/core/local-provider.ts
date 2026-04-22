import { AIClient, AIClientConfig } from './ai-client'
import { ProviderAdapter, ProviderEvent, ProviderInput } from './session-types'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface LocalProviderConfig {
  ai: Partial<AIClientConfig> & { apiKey: string }
}

export class LocalProvider implements ProviderAdapter {
  private aiClient: AIClient

  constructor(config: LocalProviderConfig) {
    this.aiClient = new AIClient(config.ai)
  }

  async *run(input: ProviderInput): AsyncIterable<ProviderEvent> {
    if (!input.screenshot) {
      yield { type: 'skip' }
      return
    }

    await this.persistDebugInput(input)
    yield { type: 'thinking', content: '正在分析聊天内容...' }

    try {
      const reply = await this.aiClient.getReply(input.screenshot)

      if (!reply) {
        yield { type: 'skip' }
        return
      }

      yield { type: 'reply_text', content: reply }
    } catch (error: any) {
      yield {
        type: 'error',
        error: error?.message || String(error) || 'Provider 调用失败'
      }
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    return this.aiClient.testConnection()
  }

  updateConfig(config: Partial<AIClientConfig>): void {
    this.aiClient.updateConfig(config)
  }

  private async persistDebugInput(input: ProviderInput): Promise<void> {
    try {
      const parsed = this.parseScreenshotData(input.screenshot)
      if (!parsed) {
        console.warn('[LocalProvider] 未能解析 provider 输入截图，跳过落盘')
        return
      }

      const debugDir = path.join(os.tmpdir(), 'sightflow-desktop-agent', 'provider-inputs')
      await mkdir(debugDir, { recursive: true })

      const stamp = this.createTimestamp()
      const baseName = `${stamp}-${input.appType}`
      const imagePath = path.join(debugDir, `${baseName}.${parsed.extension}`)
      const metaPath = path.join(debugDir, `${baseName}.json`)
      const latestImagePath = path.join(debugDir, `latest-${input.appType}.${parsed.extension}`)
      const latestMetaPath = path.join(debugDir, `latest-${input.appType}.json`)

      const metadata = {
        savedAt: new Date().toISOString(),
        appType: input.appType,
        currentContact: input.currentContact ?? null,
        ocrText: input.ocrText ?? null,
        mimeType: parsed.mimeType,
        imageBytes: parsed.buffer.length,
        imagePath
      }

      await writeFile(imagePath, parsed.buffer)
      await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
      await writeFile(latestImagePath, parsed.buffer)
      await writeFile(latestMetaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')

      console.log(
        `[LocalProvider] 模型输入截图已保存: ${imagePath} (${parsed.buffer.length} bytes, mime=${parsed.mimeType})`
      )
      console.log(`[LocalProvider] 模型输入元数据已保存: ${metaPath}`)
      console.log(`[LocalProvider] 当前最新截图快捷路径: ${latestImagePath}`)
    } catch (error) {
      console.error('[LocalProvider] 保存模型输入截图失败:', error)
    }
  }

  private parseScreenshotData(
    screenshot: string
  ): { buffer: Buffer; mimeType: string; extension: string } | null {
    const dataUrlMatch = screenshot.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
    if (dataUrlMatch) {
      const mimeType = dataUrlMatch[1]
      const base64 = dataUrlMatch[2]
      const extension = this.mimeTypeToExtension(mimeType)
      return {
        buffer: Buffer.from(base64, 'base64'),
        mimeType,
        extension
      }
    }

    if (!screenshot.trim()) {
      return null
    }

    return {
      buffer: Buffer.from(screenshot, 'base64'),
      mimeType: 'image/png',
      extension: 'png'
    }
  }

  private mimeTypeToExtension(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg':
        return 'jpg'
      case 'image/webp':
        return 'webp'
      default:
        return 'png'
    }
  }

  private createTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-')
  }
}
