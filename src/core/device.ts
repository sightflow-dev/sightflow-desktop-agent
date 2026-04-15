// src/core/device.ts
// Business Atomic Device — 业务原子驱动层
//
// Engine 唯一依赖的感知+动作接口。
// 此接口为 AgentHooks 插件系统的基础 —— 不同的 Hooks 实现（LocalHooks / CloudHooks）
// 共享同一个 Device。

import { AppType } from './rpa/types'
import { BBox } from './rpa/vision-utils'

export interface DesktopDevice {
  // ── 配置 ──
  setAppType(appType: AppType): void
  setApiKey(apiKey: string): void

  // ── 感知层 ──

  /**
   * 启动时一次性布局测量（VLM 定位 chatEntrance / firstContact / inputArea 并缓存）
   * 返回 true 表示测量成功，后续 hasUnreadMessage 可直接用缓存做红点扫描
   */
  measureLayout(): Promise<{ success: boolean; error?: string }>

  /** 全窗口截图 → base64 */
  screenshot(): Promise<string>

  /**
   * Step 1 粗检测：聊天入口是否有红点？
   * 内部流程: VLM 定位 chatEntranceArea → 局部 crop → 红点像素扫描
   */
  hasUnreadMessage(): Promise<{
    hasUnread: boolean
    chatEntranceArea?: { bbox: BBox; coordinates: [number, number] }
  }>

  /**
   * Step 2 细检测：第一个联系人头像是否有红点？
   * 内部流程: VLM 定位 firstContact → 局部 crop → 红点扫描 + 边缘分析 + 自适应重试
   */
  isChatContactUnread(): Promise<{
    isUnread: boolean
    firstContactCoords?: [number, number]
  }>

  /**
   * 清除未读区域的 VLM 坐标缓存（chatEntranceArea + firstContact）
   * 当连续检测失败时，清除缓存强制重新检测
   */
  clearUnreadCache(): void

  // ── chatMainArea Diff 检测 ──

  /**
   * 保存当前 chatMainArea 截图作为 diff baseline
   * 在 processCurrentChat 回复完成后调用
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

  /** 发送消息（clipboard paste + enter） */
  sendMessage(text: string): Promise<void>

  /**
   * 点击红点区域激活未读消息（视觉路线）
   * 微信场景双击，企业微信场景单击
   */
  activeUnreadByClick(coordinates: [number, number]): Promise<void>

  /**
   * 点击联系人列表中的第一个联系人
   */
  clickUnreadContact(coordinates: [number, number]): Promise<void>

  /** 点击指定坐标 */
  clickAt(x: number, y: number): Promise<void>
}
