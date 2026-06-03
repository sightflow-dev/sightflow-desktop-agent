// src/core/device.ts
// Business Atomic Device — 业务原子驱动层
//
// 当前主路径里，这个接口由 ChannelSession 依赖，用于统一访问宿主应用的感知与动作能力。
// 旧的 hook-based 编排已移除，宿主编排只保留 Runtime / Channel / Provider 这条主线。
//
// 当前实现：
// - `RPADevice` 用 VLM 测量 LayoutCache。
// - `BoxSelectDevice` 用用户框选结果测量 LayoutCache。
// 两条路径后续都通过 LayoutCache 消费位置。

import { AppType } from './rpa/types'
import { BBox } from './rpa/vision-utils'

export interface DesktopDevice {
  // ── 配置 ──
  setAppType(appType: AppType): void
  setApiKey(apiKey: string): void

  // ── 生命周期 ──
  // session 启停时由 GenericChannelSession 调用，给设备机会做缓存初始化 / 清理。
  // 默认实现可为 no-op；设备在 onSessionStop 里清掉布局和 baseline。
  onSessionStart?(): Promise<void> | void
  onSessionStop?(): Promise<void> | void

  // ── 感知层 ──

  /**
   * 启动时一次性布局测量。
   * VLM / box-select 都产出统一 LayoutCache，后续截图、diff、发送只消费 LayoutCache。
   */
  measureLayout(): Promise<{ success: boolean; error?: string }>

  /** 全窗口截图 → base64 */
  screenshot(): Promise<string>

  /**
   * Step 1 粗检测：聊天入口是否有红点？
   * 内部流程: 定位 chatEntranceArea / contactList → 局部 crop → 红点像素扫描。
   * 缺少未读切换位置时返回无未读，session 会回到 chatMain diff 轮询。
   */
  hasUnreadMessage(): Promise<{
    hasUnread: boolean
    chatEntranceArea?: { bbox: BBox; coordinates: [number, number] }
  }>

  /**
   * Step 2 细检测：第一个联系人头像是否有红点？
   * 内部流程: 定位 firstContact → 局部 crop → 红点扫描 + 边缘分析 + 自适应重试
   */
  isChatContactUnread(): Promise<{
    isUnread: boolean
    firstContactCoords?: [number, number]
  }>

  /**
   * 清除未读区域的坐标缓存（chatEntranceArea + firstContact）。
   * 清除未读区域缓存。
   */
  clearUnreadCache(): void

  // ── chatMainArea Diff 检测 ──

  /**
   * 保存当前 chatMainArea 截图作为 diff baseline
   * 在 channel 消费完 reply / skip 后调用
   */
  setChatBaseline(): Promise<boolean>

  /**
   * 检查 chatMainArea 是否有变化（和 baseline 对比）
   * 发现变化说明当前对话有新消息进来
   */
  hasChatAreaChanged(): Promise<{ hasDiff: boolean; hasBaseline: boolean }>

  /**
   * 清除 diff baseline
   */
  clearChatBaseline(): void

  // ── 动作层 ──

  /** 填入草稿（clipboard paste，不发送） */
  fillDraft(text: string): Promise<void>

  /** 发送消息（clipboard paste + enter） */
  sendMessage(text: string): Promise<void>

  /**
   * 点击红点区域激活未读消息（视觉路线）
   * 微信场景双击，其他场景单击（具体由设备根据 appType 决定）
   */
  activeUnreadByClick(coordinates: [number, number]): Promise<void>

  /**
   * 点击联系人列表中的第一个联系人
   */
  clickUnreadContact(coordinates: [number, number]): Promise<void>

  /** 点击指定坐标 */
  clickAt(x: number, y: number): Promise<void>
}
