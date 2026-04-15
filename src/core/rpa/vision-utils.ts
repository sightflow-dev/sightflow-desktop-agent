// src/core/rpa/vision-utils.ts
// VLM 视觉检测工具
//
// 用 AIClient.detectVision() 调豆包 VLM，解析返回的 bbox/point 坐标
// 检测微信/企微布局（聊天入口、联系人列表、输入框等）

import { AIClient } from '../ai-client'
import { AppType } from './types'
import { captureWechatWindow } from './screenshot-utils'
import { getWindowInfo, getWindowInfoSync } from './window-utils'

const IS_WINDOWS = process.platform === 'win32'

// ── 类型定义 ──

export type BBox = [number, number, number, number] // [x1, y1, x2, y2] 归一化 0-1000

export interface LayoutAreaItem {
  bbox: BBox
  coordinates: [number, number] // 屏幕绝对坐标
}

export interface LayoutCache {
  // ── 未读检测区域（detectUnreadArea） ──
  chatEntranceArea: LayoutAreaItem | null   // 聊天入口按钮（粗检测红点）
  firstContact: LayoutAreaItem | null       // 联系人列表第一行（细检测红点）

  // ── 主布局区域（detectWechatLayout） ──
  searchInputBox: LayoutAreaItem | null     // 搜索输入框
  headerArea: LayoutAreaItem | null         // 对话窗口 header
  chatMainArea: LayoutAreaItem | null       // 聊天记录区（diff 检测用）

  // ── 输入框区域（从 chatMainArea 反推） ──
  messageInputArea: LayoutAreaItem | null   // 文字输入框（chatMainArea 底边 → 窗口底边）

  timestamp: number
  appType: AppType
}

// ── 布局缓存（内存） ──

const layoutCacheMemory = new Map<AppType, LayoutCache>()

export function getLayoutCache(appType: AppType): LayoutCache | null {
  return layoutCacheMemory.get(appType) || null
}

export function setLayoutCache(appType: AppType, cache: LayoutCache): void {
  layoutCacheMemory.set(appType, cache)
}

export function clearLayoutCache(appType: AppType): void {
  layoutCacheMemory.delete(appType)
}

// ── BBox / Point 解析 ──

/**
 * 从 VLM 返回文本中解析所有 <bbox> 标签
 * 支持格式:
 *   - <bbox>x1,y1,x2,y2</bbox>  (逗号分隔)
 *   - <bbox>x1 y1 x2 y2</bbox>  (空格分隔)
 * 坐标为归一化 0-1000
 */
export function parseBBoxes(text: string): BBox[] {
  if (!text) return []
  const bboxes: BBox[] = []

  // 1. 先尝试逗号分隔格式（标准格式）
  let regex = /<bbox>\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*<\/bbox>/gi
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const x1 = Number(match[1])
    const y1 = Number(match[2])
    const x2 = Number(match[3])
    const y2 = Number(match[4])
    if ([x1, y1, x2, y2].every(v => Number.isFinite(v))) {
      bboxes.push([Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)])
    }
  }

  // 2. 如果没有找到逗号分隔的格式，尝试空格分隔
  if (bboxes.length === 0) {
    regex = /<bbox>\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*<\/bbox>/gi

    while ((match = regex.exec(text)) !== null) {
      const x1 = Number(match[1])
      const y1 = Number(match[2])
      const x2 = Number(match[3])
      const y2 = Number(match[4])
      if ([x1, y1, x2, y2].every(v => Number.isFinite(v))) {
        bboxes.push([Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)])
      }
    }
  }

  return bboxes
}

/**
 * 从 VLM 返回文本中解析 <point> 标签
 * 格式: <point>x y</point> 或 <point>x,y</point>  (归一化 0-1000)
 */
export function parsePoint(text: string): [number, number] | null {
  const regex = /<point>\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*<\/point>/i
  const match = regex.exec(text)
  if (!match) return null

  return [
    Math.round(parseFloat(match[1])),
    Math.round(parseFloat(match[2]))
  ]
}

// ── 坐标转换 ──

/**
 * 归一化 bbox (0-1000) → 屏幕绝对坐标（中心点）
 *
 * 关键平台差异：
 * - macOS: robotjs 用逻辑像素坐标
 * - Windows: robotjs 用物理像素坐标
 */
export function bboxToScreenCoords(
  bbox: BBox,
  bounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number
): [number, number] {
  const [x1, y1, x2, y2] = bbox

  // 归一化 → 相对于窗口的逻辑像素
  const logicalX = ((x1 + x2) / 2 / 1000) * bounds.width
  const logicalY = ((y1 + y2) / 2 / 1000) * bounds.height

  if (IS_WINDOWS) {
    // Windows: robotjs 用物理像素
    const screenX = Math.round((bounds.x + logicalX) * scaleFactor)
    const screenY = Math.round((bounds.y + logicalY) * scaleFactor)
    return [screenX, screenY]
  } else {
    // macOS: robotjs 用逻辑像素
    const screenX = Math.round(bounds.x + logicalX)
    const screenY = Math.round(bounds.y + logicalY)
    return [screenX, screenY]
  }
}

/**
 * 归一化 point (0-1000) → 屏幕绝对坐标
 */
export function pointToScreenCoords(
  point: [number, number],
  bounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number
): [number, number] {
  const [px, py] = point

  const logicalX = (px / 1000) * bounds.width
  const logicalY = (py / 1000) * bounds.height

  if (IS_WINDOWS) {
    return [
      Math.round((bounds.x + logicalX) * scaleFactor),
      Math.round((bounds.y + logicalY) * scaleFactor)
    ]
  } else {
    return [
      Math.round(bounds.x + logicalX),
      Math.round(bounds.y + logicalY)
    ]
  }
}

/**
 * 归一化 bbox (0-1000) → 相对于窗口的逻辑像素 crop 区域
 * （用于 captureWechatWindow 的 crop 参数）
 */
export function bboxToCropBounds(
  bbox: BBox,
  windowBounds: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const [bx1, by1, bx2, by2] = bbox

  const x1 = (bx1 / 1000) * windowBounds.width
  const y1 = (by1 / 1000) * windowBounds.height
  const x2 = (bx2 / 1000) * windowBounds.width
  const y2 = (by2 / 1000) * windowBounds.height

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}

// ── VLM 布局检测 Prompt ──

const UNREAD_AREA_PROMPTS: Record<'weixin' | 'wework', { prompt: string; targets: string[] }> = {
  weixin: {
    prompt: `你是一个微信布局解析专家。

## 微信桌面端布局
- 最左侧一列是导航栏，从上到下前三个按钮：头像、聊天入口💬、联系人
- 聊天入口按钮区域：包含💬图标和可能的红色圆形数字角标
- 左侧第二列是聊天联系人列表，第一行是最新消息的联系人，头像右上角可能有红色未读气泡

## 你的职责
帮我框选以下两个区域，每个区域用 <bbox>x1,y1,x2,y2</bbox> 格式，坐标范围 0-1000：
1. 【聊天入口按钮区域】— 导航栏中的聊天按钮，包含图标和红色角标
2. 【聊天联系人列表第一行】— 第一个联系人的头像区域，包含头像和红色未读气泡`,
    targets: ['【聊天入口按钮区域】', '【聊天联系人列表第一行】']
  },
  wework: {
    prompt: `你是一个企业微信布局解析专家。

## 企业微信桌面端布局（三栏式）
- 左侧导航栏：顶部用户头像、功能菜单（消息/通讯录/邮件/日程/工作台），系统分组
- 中间消息列表：顶部搜索框，下方是联系人消息列表，有未读红点
- 右侧聊天区

## 你的职责
帮我框选以下两个区域，每个区域用 <bbox>x1,y1,x2,y2</bbox> 格式，坐标范围 0-1000：
1. 【消息按钮区域】— 左侧导航栏中的消息按钮区域，包含按钮和红色角标
2. 【消息列表第一行】— 中间消息列表第一条消息项的头像区域`,
    targets: ['【消息按钮区域】', '【消息列表第一行】']
  }
}

// ── 核心检测函数 ──

/**
 * 检测聊天入口区域和第一个联系人（用于红点检测的"两步走"）
 *
 * 返回: chatEntranceArea (Step 1 粗检测区域) + firstContact (Step 2 细检测区域)
 * 结果写入 LayoutCache
 */
export async function detectUnreadArea(
  aiClient: AIClient,
  appType: AppType
): Promise<{
  success: boolean
  chatEntranceArea?: { bbox: BBox; coordinates: [number, number] }
  firstContact?: { bbox: BBox; coordinates: [number, number] }
  error?: string
}> {
  try {
    // 1. 截图
    const screenshotResult = await captureWechatWindow(appType)
    if (!screenshotResult.success || !screenshotResult.screenshotBase64) {
      return { success: false, error: screenshotResult.error || '截图失败' }
    }

    // 2. 获取窗口信息（用于坐标转换）
    const windowInfo = await getWindowInfo(appType, false)
    if (!windowInfo?.bounds || !windowInfo?.scaleFactor) {
      return { success: false, error: '获取窗口信息失败' }
    }

    // 3. 选择 prompt
    const promptKey = appType === 'wework' ? 'wework' : 'weixin'
    const config = UNREAD_AREA_PROMPTS[promptKey]

    // 4. 调 VLM
    console.log('[VisionUtils] 调用 VLM 检测未读区域...')
    const vlmResult = await aiClient.detectVision(config.prompt, screenshotResult.screenshotBase64)
    console.log('[VisionUtils] VLM 返回:', vlmResult.slice(0, 300))

    // 5. 解析 bbox
    const bboxes = parseBBoxes(vlmResult)
    if (bboxes.length === 0) {
      return { success: false, error: '未检测到任何区域' }
    }

    const { bounds, scaleFactor } = windowInfo

    // 6. chatEntranceArea — 第一个 bbox
    const chatEntranceCoords = bboxToScreenCoords(bboxes[0], bounds, scaleFactor)
    const chatEntranceArea = { bbox: bboxes[0], coordinates: chatEntranceCoords }

    // 7. firstContact — 第二个 bbox（如果有）
    let firstContact: { bbox: BBox; coordinates: [number, number] } | null = null
    if (bboxes[1]) {
      const firstContactCoords = bboxToScreenCoords(bboxes[1], bounds, scaleFactor)
      firstContact = { bbox: bboxes[1], coordinates: firstContactCoords }
    }

    // 8. 更新缓存
    const existingCache = getLayoutCache(appType)
    setLayoutCache(appType, {
      ...(existingCache || {
        searchInputBox: null,
        headerArea: null,
        chatMainArea: null,
        messageInputArea: null
      }),
      chatEntranceArea,
      firstContact,
      timestamp: Date.now(),
      appType
    } as LayoutCache)

    console.log('[VisionUtils] 未读区域检测完成', {
      chatEntranceArea: chatEntranceArea.coordinates,
      firstContact: firstContact?.coordinates
    })

    return { success: true, chatEntranceArea, firstContact: firstContact || undefined }
  } catch (error: any) {
    console.error('[VisionUtils] 检测失败:', error)
    return { success: false, error: error?.message || String(error) }
  }
}

/**
 * 获取未读区域（优先用缓存，没有则调 VLM 检测）
 */
export async function getUnreadArea(
  aiClient: AIClient,
  appType: AppType
): Promise<{
  chatEntranceArea: { bbox: BBox; coordinates: [number, number] } | null
  firstContact: { bbox: BBox; coordinates: [number, number] } | null
}> {
  const cache = getLayoutCache(appType)

  // 有完整缓存直接返回
  if (cache?.chatEntranceArea && cache?.firstContact) {
    return {
      chatEntranceArea: cache.chatEntranceArea,
      firstContact: cache.firstContact
    }
  }

  // 没有缓存，调 VLM 检测
  console.log('[VisionUtils] 缓存不存在，开始 VLM 检测')
  const result = await detectUnreadArea(aiClient, appType)

  if (!result.success) {
    console.error('[VisionUtils] 检测失败:', result.error)
    return {
      chatEntranceArea: cache?.chatEntranceArea || null,
      firstContact: cache?.firstContact || null
    }
  }

  return {
    chatEntranceArea: result.chatEntranceArea || null,
    firstContact: result.firstContact || null
  }
}

/**
 * 从 chatMainArea 反推输入框区域（纯计算，无外部调用）
 *
 * 原理：
 * - 窗口右侧 = chatMainArea（聊天记录区）+ InputArea（文字输入区）上下排列
 * - InputArea.x1 = chatMainArea.x1（同宽左边）
 * - InputArea.x2 = chatMainArea.x2（同宽右边）
 * - InputArea.y1 = chatMainArea.y2（chatMainArea 底边 = InputArea 顶边）
 * - InputArea.y2 = 1000（窗口底边）
 */
export function getInputAreaFromCache(
  appType: AppType
): LayoutAreaItem | null {
  const cache = getLayoutCache(appType)

  // 已有 messageInputArea 直接返回
  if (cache?.messageInputArea) {
    return cache.messageInputArea
  }

  // 从 chatMainArea 反推
  if (!cache?.chatMainArea) {
    console.warn('[VisionUtils] chatMainArea 不存在，无法反推 inputArea')
    return null
  }

  const [x1, _y1, x2, y2] = cache.chatMainArea.bbox
  const inputBbox: BBox = [x1, y2, x2, 1000] // chatMainArea 底边 → 窗口底边

  // 需要窗口信息来转换坐标
  // 这里用 chatMainArea 的坐标来估算：inputArea 中心 = (x1+x2)/2, (y2+1000)/2
  // 但更精确的方式是拿窗口 bounds 转换
  const windowInfo = getWindowInfoSync(appType)
  if (!windowInfo?.bounds) {
    console.warn('[VisionUtils] 窗口信息不可用，使用粗略坐标估算')
    return null
  }

  const { bounds, scaleFactor } = windowInfo
  const coordinates = bboxToScreenCoords(inputBbox, bounds, scaleFactor)
  const messageInputArea: LayoutAreaItem = { bbox: inputBbox, coordinates }

  // 写入缓存
  setLayoutCache(appType, {
    ...cache,
    messageInputArea,
    timestamp: Date.now()
  })

  console.log('[VisionUtils] 从 chatMainArea 反推 inputArea:', {
    chatMainArea: cache.chatMainArea.bbox,
    inputArea: inputBbox,
    coordinates
  })

  return messageInputArea
}

// ── 布局主检测 Prompt ──

const LAYOUT_DETECT_PROMPTS: Record<'weixin' | 'wework', { prompt: string; targets: string[] }> = {
  weixin: {
    prompt: `你是一个微信布局解析专家。你熟知微信桌面端的布局。

## 微信桌面端布局
- 最左侧一列是导航栏
- 左侧第二列是聊天联系人列表，顶部是搜索输入框
- 第三列是对话区域，由上中下三部分组成：顶部是 header（显示对话人名称），中间是聊天记录区，底部是文字输入区域

## 你的职责
帮我框选以下三个区域，每个区域用 <bbox>x1,y1,x2,y2</bbox> 格式，坐标范围 0-1000：
1. 【搜索输入框】— 聊天联系人列表顶部的搜索栏
2. 【对话窗口header区域】— 对话区域最顶上一条，显示当前对话人的名称
3. 【聊天记录区】— 对话区域中间部分，显示历史聊天气泡的区域`,
    targets: ['【搜索输入框】', '【对话窗口header区域】', '【聊天记录区】']
  },
  wework: {
    prompt: `你是一个企业微信布局解析专家。企业微信Mac客户端界面是三栏式布局：

- 左侧导航栏：顶部用户头像，功能菜单（消息/通讯录/邮件/日程/工作台）
- 中间消息列表：顶部搜索框+加号，下面是消息项
- 右侧聊天区：顶部header、中间聊天记录区、底部输入框

## 你的职责
帮我框选以下三个区域，每个区域用 <bbox>x1,y1,x2,y2</bbox> 格式，坐标范围 0-1000：
1. 【搜索输入框】— 中间消息列表顶部的搜索栏
2. 【右侧聊天区顶部】— 右侧聊天区最顶上一条，显示当前聊天人/群名
3. 【聊天记录区】— 右侧聊天区中间部分，显示聊天气泡的区域`,
    targets: ['【搜索输入框】', '【右侧聊天区顶部】', '【聊天记录区】']
  }
}

/**
 * 检测微信/企微主布局：搜索输入框 + header区域 + 聊天记录区
 * 结果写入 LayoutCache
 */
export async function detectWechatLayout(
  aiClient: AIClient,
  appType: AppType
): Promise<{
  success: boolean
  searchInputBox?: LayoutAreaItem
  headerArea?: LayoutAreaItem
  chatMainArea?: LayoutAreaItem
  error?: string
}> {
  try {
    console.log('[VisionUtils] 开始微信布局检测...')

    // 1. 截图
    const screenshotResult = await captureWechatWindow(appType)
    if (!screenshotResult.success || !screenshotResult.screenshotBase64) {
      return { success: false, error: screenshotResult.error || '截图失败' }
    }

    // 2. 获取窗口信息
    const windowInfo = await getWindowInfo(appType, false)
    if (!windowInfo?.bounds || !windowInfo?.scaleFactor) {
      return { success: false, error: '获取窗口信息失败' }
    }

    // 3. 选择 prompt
    const promptKey = appType === 'wework' ? 'wework' : 'weixin'
    const config = LAYOUT_DETECT_PROMPTS[promptKey]

    // 4. 调 VLM
    console.log('[VisionUtils] 调用 VLM 检测布局...')
    const vlmResult = await aiClient.detectVision(config.prompt, screenshotResult.screenshotBase64)
    console.log('[VisionUtils] VLM 布局检测返回:', vlmResult.slice(0, 300))

    // 5. 解析 bbox
    const bboxes = parseBBoxes(vlmResult)
    if (bboxes.length === 0) {
      return { success: false, error: '布局检测未返回任何区域' }
    }

    const { bounds, scaleFactor } = windowInfo

    // 6. 转换坐标
    const searchInputBox: LayoutAreaItem | undefined = bboxes[0]
      ? { bbox: bboxes[0], coordinates: bboxToScreenCoords(bboxes[0], bounds, scaleFactor) }
      : undefined

    const headerArea: LayoutAreaItem | undefined = bboxes[1]
      ? { bbox: bboxes[1], coordinates: bboxToScreenCoords(bboxes[1], bounds, scaleFactor) }
      : undefined

    const chatMainArea: LayoutAreaItem | undefined = bboxes[2]
      ? { bbox: bboxes[2], coordinates: bboxToScreenCoords(bboxes[2], bounds, scaleFactor) }
      : undefined

    // 7. 更新缓存
    const existingCache = getLayoutCache(appType)
    setLayoutCache(appType, {
      ...(existingCache || {
        chatEntranceArea: null,
        firstContact: null,
        messageInputArea: null
      }),
      searchInputBox: searchInputBox || null,
      headerArea: headerArea || null,
      chatMainArea: chatMainArea || null,
      timestamp: Date.now(),
      appType
    } as LayoutCache)

    console.log('[VisionUtils] 布局检测完成', {
      searchInputBox: searchInputBox?.coordinates,
      headerArea: headerArea?.coordinates,
      chatMainArea: chatMainArea?.coordinates
    })

    return { success: true, searchInputBox, headerArea, chatMainArea }
  } catch (error: any) {
    console.error('[VisionUtils] 布局检测失败:', error)
    return { success: false, error: error?.message || String(error) }
  }
}
