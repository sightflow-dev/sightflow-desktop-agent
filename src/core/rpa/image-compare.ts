// src/core/rpa/image-compare.ts
// 像素级图片对比 — 用 pixelmatch 检测聊天区域是否有变化
//
// 用途：
// - diff 预筛：chatMainArea 没变化就不触发后续检测
// - 快捷键验证：切换未读后 diff 确认是否生效

import _pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

// pixelmatch v7 是纯 ESM 包，Rollup CJS interop 可能把 module 对象当 default export
// 运行时 fallback：如果不是函数就取 .default
const pixelmatch: typeof _pixelmatch =
  typeof _pixelmatch === 'function'
    ? _pixelmatch
    : ((_pixelmatch as any).default as typeof _pixelmatch)

export interface CompareResult {
  /** 是否有变化 */
  hasChanged: boolean
  /** 差异像素占比 (0-100) */
  diffPercentage: number
  /** 完全相同？ */
  identical: boolean
  /** 差异像素数 */
  diffPixelCount: number
  /** 总像素数 */
  totalPixels: number
}

export interface CompareOptions {
  /** pixelmatch 阈值 (0-1)，越小越敏感。默认 0.1 */
  threshold?: number
  /** 判定"有变化"的最低 diffPercentage。默认 0.5% */
  changeThreshold?: number
}

/**
 * 比较两张 NativeImage（Electron）的差异
 */
export function compareImages(
  img1: Electron.NativeImage,
  img2: Electron.NativeImage,
  options: CompareOptions = {}
): CompareResult {
  const { threshold = 0.1, changeThreshold = 0.5 } = options

  // 转为 PNG Buffer
  const buf1 = img1.toPNG()
  const buf2 = img2.toPNG()

  const png1 = PNG.sync.read(buf1)
  const png2 = PNG.sync.read(buf2)

  // 尺寸不同直接判定有变化
  if (png1.width !== png2.width || png1.height !== png2.height) {
    const totalPixels = Math.max(png1.width * png1.height, png2.width * png2.height)
    return {
      hasChanged: true,
      diffPercentage: 100,
      identical: false,
      diffPixelCount: totalPixels,
      totalPixels
    }
  }

  const { width, height } = png1
  const totalPixels = width * height

  if (totalPixels === 0) {
    return {
      hasChanged: false,
      diffPercentage: 0,
      identical: true,
      diffPixelCount: 0,
      totalPixels: 0
    }
  }

  // pixelmatch 对比
  const diffPixelCount = pixelmatch(
    png1.data as unknown as Uint8Array,
    png2.data as unknown as Uint8Array,
    undefined, // 不生成 diff 图
    width,
    height,
    { threshold }
  )

  const diffPercentage = (diffPixelCount / totalPixels) * 100
  const identical = diffPixelCount === 0
  const hasChanged = diffPercentage > changeThreshold

  return {
    hasChanged,
    diffPercentage: Math.round(diffPercentage * 100) / 100,
    identical,
    diffPixelCount,
    totalPixels
  }
}

/**
 * 快速判断两张图片是否有变化（简化版）
 */
export function hasImageChanged(
  img1: Electron.NativeImage,
  img2: Electron.NativeImage,
  changeThreshold = 0.5
): boolean {
  return compareImages(img1, img2, { changeThreshold }).hasChanged
}

// ── chatMainArea Diff 检测 ──
//
// 参考 whatsapp-agent-demo 的 checkChatDiffForAssistMode
// 用途：回复结束后轮询 chatMainArea 截图差异，发现界面变化说明有新消息

import { AppType } from './types'
import { captureChatMainArea } from './screenshot-utils'

/** baseline 截图（内存，app 关闭后丢失） */
let chatBaseline: Electron.NativeImage | null = null

/** 保存当前 chatMainArea 截图作为 baseline */
export async function setChatBaseline(appType: AppType): Promise<boolean> {
  const screenshot = await captureChatMainArea(appType)
  if (screenshot) {
    chatBaseline = screenshot
    console.log('[ChatDiff] baseline 已设置')
    return true
  }
  console.warn('[ChatDiff] baseline 设置失败：截图为空')
  return false
}

/** 清除 baseline */
export function clearChatBaseline(): void {
  chatBaseline = null
}

/** 是否有 baseline */
export function hasChatBaseline(): boolean {
  return chatBaseline !== null
}

/**
 * 检查 chatMainArea 是否有变化（和 baseline 对比）
 *
 * 流程（对齐 whatsapp-agent-demo 的 checkChatDiffForAssistMode）：
 * 1. 无 baseline → 返回无变化
 * 2. 截图当前 chatMainArea
 * 3. pixelmatch 对比
 * 4. 有差异 → 返回 hasDiff: true
 */
export async function checkChatAreaDiff(appType: AppType): Promise<{
  hasDiff: boolean
  hasBaseline: boolean
}> {
  if (!chatBaseline) {
    console.log('[ChatDiff] 无 baseline，无法对比')
    return { hasDiff: false, hasBaseline: false }
  }

  const current = await captureChatMainArea(appType)
  if (!current) {
    console.log('[ChatDiff] 截图失败，继续轮询')
    return { hasDiff: false, hasBaseline: true }
  }

  const result = compareImages(chatBaseline, current, {
    threshold: 0.1,
    changeThreshold: 0.5
  })

  console.log('[ChatDiff] 对比结果:', {
    hasChanged: result.hasChanged,
    diffPercentage: `${result.diffPercentage}%`,
    identical: result.identical
  })

  if (result.hasChanged && !result.identical) {
    // 有差异 → baseline 不清空，processCurrentChat 之后会重新 setChatBaseline 覆盖
    return { hasDiff: true, hasBaseline: true }
  }

  return { hasDiff: false, hasBaseline: true }
}
