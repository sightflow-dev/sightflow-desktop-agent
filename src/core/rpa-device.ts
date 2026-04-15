// src/core/rpa-device.ts
// RPADevice — DesktopDevice 的真实 RPA 实现
//
// 串联 screenshot-utils、input-utils、has-unread、vision-utils
// 所有感知和动作能力在这里汇聚

import { DesktopDevice } from './device'
import { AIClient } from './ai-client'
import { AppType } from './rpa/types'
import { BBox } from './rpa/vision-utils'
import { takeWeChatScreenshot } from './rpa/screenshot-utils'
import { sendReplyAction, activeUnreadByClickAction, clickUnreadContactAction } from './rpa/input-utils'
import {
  hasUnreadMessage as hasUnreadMessageDetect,
  isChatContactUnread as isChatContactUnreadDetect
} from './rpa/has-unread'
import {
  detectUnreadArea as detectUnreadAreaFn,
  detectWechatLayout,
  getInputAreaFromCache,
  getLayoutCache,
  setLayoutCache
} from './rpa/vision-utils'

export class RPADevice implements DesktopDevice {
  private appType: AppType = 'weixin'
  private aiClient: AIClient | null = null

  setAppType(appType: AppType): void {
    this.appType = appType
  }

  setApiKey(apiKey: string): void {
    if (!apiKey) return
    this.aiClient = new AIClient({ apiKey })
  }

  // ── 感知层 ──

  /**
   * 启动时一次性 VLM 布局测量（并行执行）
   *
   * 并行调两个 VLM 检测任务:
   * 1. detectUnreadArea — chatEntranceArea + firstContact（红点检测用）
   * 2. detectWechatLayout — searchInputBox + headerArea + chatMainArea（diff/搜索用）
   *
   * 检测完成后，从 chatMainArea 反推 inputArea（纯计算，无外部调用）
   */
  async measureLayout(): Promise<boolean> {
    if (!this.aiClient) {
      console.error('[RPADevice] aiClient 未初始化，无法测量布局')
      return false
    }

    try {
      console.log('[RPADevice] 开始布局测量（并行）...')

      const [unreadResult, layoutResult] = await Promise.allSettled([
        detectUnreadAreaFn(this.aiClient, this.appType),
        detectWechatLayout(this.aiClient, this.appType)
      ])

      // 检查结果
      const unreadOk = unreadResult.status === 'fulfilled' && unreadResult.value.success
      const layoutOk = layoutResult.status === 'fulfilled' && layoutResult.value.success

      console.log('[RPADevice] VLM 检测结果:', {
        detectUnreadArea: unreadOk ? '✓' : '✗',
        detectWechatLayout: layoutOk ? '✓' : '✗'
      })

      if (unreadResult.status === 'fulfilled' && unreadResult.value.success) {
        console.log('[RPADevice] 未读区域:', {
          chatEntrance: unreadResult.value.chatEntranceArea?.coordinates,
          firstContact: unreadResult.value.firstContact?.coordinates
        })
      } else {
        const error = unreadResult.status === 'rejected'
          ? unreadResult.reason
          : (unreadResult.value as any)?.error
        console.error('[RPADevice] 未读区域检测失败:', error)
      }

      if (layoutResult.status === 'fulfilled' && layoutResult.value.success) {
        console.log('[RPADevice] 主布局:', {
          searchInputBox: layoutResult.value.searchInputBox?.coordinates,
          headerArea: layoutResult.value.headerArea?.coordinates,
          chatMainArea: layoutResult.value.chatMainArea?.coordinates
        })

        // 从 chatMainArea 反推 inputArea（纯计算）
        const inputArea = getInputAreaFromCache(this.appType)
        if (inputArea) {
          console.log('[RPADevice] 输入框（反推）:', inputArea.coordinates)
        } else {
          console.warn('[RPADevice] 输入框反推失败')
        }
      } else {
        const error = layoutResult.status === 'rejected'
          ? layoutResult.reason
          : (layoutResult.value as any)?.error
        console.warn('[RPADevice] 主布局检测失败（非致命）:', error)
      }

      // 核心判定：只要 detectUnreadArea 成功就算测量通过
      // chatEntranceArea 是轮询红点的必要条件
      if (!unreadOk) {
        console.error('[RPADevice] 布局测量失败：未读区域检测是必要条件')
        return false
      }

      console.log('[RPADevice] 布局测量完成 ✓')
      return true
    } catch (error: any) {
      console.error('[RPADevice] 布局测量异常:', error)
      return false
    }
  }

  async screenshot(): Promise<string> {
    const result = await takeWeChatScreenshot({ wechatType: this.appType })
    if (!result.success || !result.screenshot) {
      throw new Error(result.error || '截图失败')
    }
    return result.screenshot
  }

  async hasUnreadMessage(): Promise<{
    hasUnread: boolean
    chatEntranceArea?: { bbox: BBox; coordinates: [number, number] }
  }> {
    if (!this.aiClient) {
      console.warn('[RPADevice] aiClient 未初始化，无法进行视觉检测')
      return { hasUnread: false }
    }

    const result = await hasUnreadMessageDetect(this.aiClient, this.appType)

    if (!result.success) {
      console.error('[RPADevice] hasUnreadMessage 失败:', result.error)
      return { hasUnread: false }
    }

    return {
      hasUnread: result.hasUnread || false,
      chatEntranceArea: result.chatEntranceArea
    }
  }

  async isChatContactUnread(): Promise<{
    isUnread: boolean
    firstContactCoords?: [number, number]
  }> {
    if (!this.aiClient) {
      console.warn('[RPADevice] aiClient 未初始化')
      return { isUnread: false }
    }

    const result = await isChatContactUnreadDetect(this.aiClient, this.appType)

    if (!result.success) {
      console.error('[RPADevice] isChatContactUnread 失败:', result.error)
      return { isUnread: false }
    }

    return {
      isUnread: result.isUnread || false,
      firstContactCoords: result.firstContact?.coordinates
    }
  }

  /**
   * 清除未读区域的 VLM 坐标缓存（chatEntranceArea + firstContact）
   * 连续检测失败时调用：强制下次 isChatContactUnread / hasUnreadMessage 重新 VLM 定位
   */
  clearUnreadCache(): void {
    const cache = getLayoutCache(this.appType)
    if (cache) {
      cache.chatEntranceArea = null
      cache.firstContact = null
      setLayoutCache(this.appType, cache)
      console.log('[RPADevice] 已清除未读区域缓存')
    }
  }

  // ── 动作层 ──

  async sendMessage(text: string): Promise<void> {
    const success = await sendReplyAction(this.appType, text, this.aiClient)
    if (!success) {
      throw new Error('发送消息失败')
    }
  }

  /**
   * 点击红点区域激活未读消息（视觉路线）
   * 微信场景双击，企业微信场景单击
   */
  async activeUnreadByClick(coordinates: [number, number]): Promise<void> {
    await activeUnreadByClickAction(coordinates, this.appType)
  }

  /**
   * 点击联系人列表中的第一个联系人
   */
  async clickUnreadContact(coordinates: [number, number]): Promise<void> {
    await clickUnreadContactAction(coordinates)
  }

  async clickAt(x: number, y: number): Promise<void> {
    await clickUnreadContactAction([x, y])
  }
}
