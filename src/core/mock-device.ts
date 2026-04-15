// src/core/mock-device.ts
// MockDevice — DesktopDevice 的模拟实现（用于开发测试）

import { DesktopDevice } from './device'
import { desktopCapturer } from 'electron'
import { AppType } from './rpa/types'
import { BBox } from './rpa/vision-utils'

export class MockDevice implements DesktopDevice {
  private appType: AppType = 'weixin'

  setAppType(appType: AppType): void {
    this.appType = appType
  }

  setApiKey(_apiKey: string): void {
    // Mock: 不需要 API key
  }

  async measureLayout(): Promise<boolean> {
    console.log('[MockDevice] 布局测量（模拟）✓')
    return true
  }

  async screenshot(): Promise<string> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    })
    if (sources && sources.length > 0) {
      return sources[0].thumbnail.toDataURL()
    }
    throw new Error('No screen sources found')
  }

  async hasUnreadMessage(): Promise<{
    hasUnread: boolean
    chatEntranceArea?: { bbox: BBox; coordinates: [number, number] }
  }> {
    // Mock: 15% 概率检测到未读
    return { hasUnread: Math.random() > 0.85 }
  }

  async isChatContactUnread(): Promise<{
    isUnread: boolean
    firstContactCoords?: [number, number]
  }> {
    // Mock: 总是返回有未读
    return { isUnread: true, firstContactCoords: [200, 200] }
  }

  clearUnreadCache(): void {
    console.log('[MockDevice] 清除未读缓存（模拟）')
  }

  async sendMessage(text: string): Promise<void> {
    console.log(`[MockDevice] Sent: ${text}`)
  }

  async activeUnreadByClick(coordinates: [number, number]): Promise<void> {
    console.log(`[MockDevice] activeUnreadByClick: (${coordinates[0]}, ${coordinates[1]})`)
  }

  async clickUnreadContact(coordinates: [number, number]): Promise<void> {
    console.log(`[MockDevice] clickUnreadContact: (${coordinates[0]}, ${coordinates[1]})`)
  }

  async clickAt(x: number, y: number): Promise<void> {
    console.log(`[MockDevice] Click: (${x}, ${y})`)
  }
}
