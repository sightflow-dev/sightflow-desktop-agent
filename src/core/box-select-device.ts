// src/core/box-select-device.ts
// BoxSelectDevice — DesktopDevice 的"用户手动框选区域 + 单会话模式"实现。
//
// 与 RPADevice 的关系：两者都实现同一 DesktopDevice 接口、由 GenericChannelSession 统一驱动。
// 区别在于"如何知道 chatMain / inputBox 在屏幕上哪里"：
//   - RPADevice  : 用 VLM 在线推理 wechat / wework 的布局，并主动扫红点切换会话。
//   - BoxSelectDevice: 用户在框选向导里手动画 3 个矩形（contactList / chatMain / inputBox）。
//     运行时只对当前已经打开的对话窗口做"chatMain pixel diff → 输入框回复"，
//     不去点 contactList 切换会话。适用于飞书 / 钉钉 / Slack / Telegram 等
//     非 wechat 场景，以及 wechat VLM 检测失败时的兜底策略。
//
// 坐标系统一约定：BoxRegions 里的矩形都是逻辑像素的绝对屏幕坐标，与 captureScreenRegion、
// humanLikeMove、screen.getDisplayMatching 一致；裁剪到物理像素的换算由 captureScreenRegion 内部处理。

import { DesktopDevice } from './device'
import { AppType, BoxRegions, ScreenRect } from './rpa/types'
import {
  BBox,
  clearLayoutCache,
  getInputAreaFromCache,
  LayoutCache,
  setLayoutCache
} from './rpa/vision-utils'
import { captureChatMainArea } from './rpa/screenshot-utils'
import {
  activeUnreadByClickAction,
  clickUnreadContactAction,
  defaultClickPolicy,
  fillDraftByCoordsAction,
  sendReplyByCoordsAction
} from './rpa/input-utils'
import { comparePngBuffers } from './rpa/image-compare'

function rectCenter(rect: ScreenRect): [number, number] {
  return [rect.x + rect.width / 2, rect.y + rect.height / 2]
}

export class BoxSelectDevice implements DesktopDevice {
  private appType: AppType = 'generic'
  private regions: BoxRegions | null
  private chatBaseline: Buffer | null = null

  constructor(regions: BoxRegions | null = null) {
    this.regions = regions
  }

  setAppType(appType: AppType): void {
    this.appType = appType
  }

  // BoxSelectDevice 不需要视觉密钥；保留 no-op 以满足接口（engine:updateConfig 会调）。
  setApiKey(apiKey: string): void {
    void apiKey
  }

  setRegions(regions: BoxRegions | null): void {
    this.regions = regions
  }

  getRegions(): BoxRegions | null {
    return this.regions
  }

  // ── 生命周期 ──
  onSessionStop(): void {
    clearLayoutCache(this.appType)
    this.chatBaseline = null
  }

  // ── 感知层 ──

  async measureLayout(): Promise<{ success: boolean; error?: string }> {
    if (!this.regions) {
      return { success: false, error: '尚未保存框选区域，请先完成框选向导' }
    }

    // 保持 box-select 既有三框模型；measureLayout 只负责把这些测量结果写入 LayoutCache。
    const required: Array<[string, ScreenRect | null | undefined]> = [
      ['contactList', this.regions.contactList],
      ['chatMain', this.regions.chatMain],
      ['inputBox', this.regions.inputBox]
    ]
    for (const [name, rect] of required) {
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { success: false, error: `框选区域 ${name} 无效，请重新框选` }
      }
    }

    const chatMainCenter = rectCenter(this.regions.chatMain)
    const inputBoxCenter = rectCenter(this.regions.inputBox)
    const layout: LayoutCache = {
      chatEntranceArea: null,
      firstContact: null,
      searchInputBox: null,
      headerArea: null,
      chatMainArea: {
        rect: this.regions.chatMain,
        coordinates: chatMainCenter,
        source: 'box-select'
      },
      messageInputArea: {
        rect: this.regions.inputBox,
        coordinates: inputBoxCenter,
        source: 'box-select'
      },
      timestamp: Date.now(),
      appType: this.appType
    }
    setLayoutCache(this.appType, layout)
    return { success: true }
  }

  // 把 chatMain 区域截图作为"会话上下文"返回给 provider VLM 分析。
  // 比起 RPADevice 整窗截图，这里更聚焦于聊天内容，省 token 且与目标 app 无关。
  async screenshot(): Promise<string> {
    const image = await captureChatMainArea(this.appType)
    if (!image) {
      throw new Error('chatMain 截图失败')
    }
    return image.toDataURL()
  }

  // 单会话模式：BoxSelectDevice 只关心"当前已经打开的对话窗口里有没有新内容"，
  // 不去扫 contactList 红点 / 点击切换会话。原因：第三方 IM（飞书 / 钉钉 / Slack 等）
  // 联系人列表布局差异太大，「激活联系人 → 回到输入框」的来回点击经常打偏，
  // 失败的代价很大（点错地方、误发到别的会话）。
  //
  // hasUnreadMessage 永远返回 false，让 GenericChannelSession 退化到 wait_retry
  // 循环，下一轮 check_unread 时只走 hasChatAreaChanged（chatMain pixel diff）。
  // 用户只要把目标对话窗口保持打开，新消息进来 → diff 命中 → 触发 observe_chat。
  async hasUnreadMessage(): Promise<{
    hasUnread: boolean
    chatEntranceArea?: { bbox: BBox; coordinates: [number, number] }
  }> {
    return { hasUnread: false }
  }

  // 单会话模式下不会被调用到（hasUnreadMessage 已返回 false）；保留实现以满足接口。
  async isChatContactUnread(): Promise<{
    isUnread: boolean
    firstContactCoords?: [number, number]
  }> {
    return { isUnread: false }
  }

  // box-select 没有 VLM 缓存可清；no-op。
  clearUnreadCache(): void {
    // intentionally empty
  }

  // ── chatMainArea Diff ──

  async setChatBaseline(): Promise<boolean> {
    const image = await captureChatMainArea(this.appType)
    if (!image) {
      console.warn('[BoxSelectDevice] baseline 设置失败: chatMain 截图为空')
      return false
    }
    this.chatBaseline = image.toPNG()
    return true
  }

  async hasChatAreaChanged(): Promise<{ hasDiff: boolean; hasBaseline: boolean }> {
    if (!this.chatBaseline) return { hasDiff: false, hasBaseline: false }

    const image = await captureChatMainArea(this.appType)
    if (!image) {
      return { hasDiff: false, hasBaseline: true }
    }
    const current = image.toPNG()
    const cmp = comparePngBuffers(this.chatBaseline, current, {
      threshold: 0.1,
      changeThreshold: 0.5
    })
    return { hasDiff: cmp.hasChanged && !cmp.identical, hasBaseline: true }
  }

  clearChatBaseline(): void {
    this.chatBaseline = null
  }

  // ── 动作层 ──

  async fillDraft(text: string): Promise<void> {
    const inputArea = getInputAreaFromCache(this.appType)
    if (!inputArea) throw new Error('尚未测量输入框区域')
    const [x, y] = inputArea.coordinates
    const ok = await fillDraftByCoordsAction(x, y, text)
    if (!ok) throw new Error('写入草稿失败')
  }

  async sendMessage(text: string): Promise<void> {
    const inputArea = getInputAreaFromCache(this.appType)
    if (!inputArea) throw new Error('尚未测量输入框区域')
    const [x, y] = inputArea.coordinates
    const ok = await sendReplyByCoordsAction(x, y, text)
    if (!ok) throw new Error('发送消息失败')
  }

  // 通用 IM 一般单击就能切换会话，统一走 defaultClickPolicy(appType)，
  // wechat 双击的特例由 RPADevice 自己负责。
  async activeUnreadByClick(coordinates: [number, number]): Promise<void> {
    await activeUnreadByClickAction(coordinates, this.appType, defaultClickPolicy(this.appType))
  }

  async clickUnreadContact(coordinates: [number, number]): Promise<void> {
    await clickUnreadContactAction(coordinates)
  }

  async clickAt(x: number, y: number): Promise<void> {
    await clickUnreadContactAction([x, y])
  }
}
