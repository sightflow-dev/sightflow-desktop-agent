import { screen } from 'electron'
import activeWin from 'active-win'
import { createRequire } from 'node:module'
import { AppType } from './types'
import { captureWechatWindow } from './screenshot-utils'
import { getErrorMessage } from '../error-utils'

const IS_WINDOWS = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const runtimeRequire = createRequire(import.meta.url)

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

interface PartialWindowBounds {
  x?: number
  y?: number
  width?: number
  height?: number
}

interface ActiveWindowLike {
  title?: string
  owner?: { name?: string }
  getTitle?: () => string
  getBounds?: () => PartialWindowBounds
  bounds?: PartialWindowBounds
  isVisible?: () => boolean
}

interface WindowInfoResult {
  wechatWindow: ActiveWindowLike
  bounds: WindowBounds
  wechatType: AppType
  display: {
    id: number
    scaleFactor: number
    bounds: Electron.Rectangle
  }
}

interface WindowManagerLike {
  getActiveWindow(): ActiveWindowLike | null
  getWindows(): ActiveWindowLike[]
}

// 包装带超时的 activeWin 调用
async function getOpenWindowsSafe(): Promise<ActiveWindowLike[]> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('active-win getOpenWindows timeout')), 5000)
    })

    // 如果系统没有给权限，activeWin在某些版本可能卡死，强制5秒超时
    const windows = await Promise.race([activeWin.getOpenWindows(), timeoutPromise])
    return windows as ActiveWindowLike[]
  } catch (err: unknown) {
    console.error('[window-utils] getOpenWindowsSafe error or timeout:', getErrorMessage(err))
    return []
  }
}

export function matchWechatType(name: string, appType: AppType): boolean {
  if ((appType as string) === 'whatsapp') {
    return ['‎WhatsApp', '‎WhatsApp.app', '‎WhatsApp.exe', 'WhatsApp'].includes(name)
  }
  const wechatName =
    appType === 'wechat' ? ['微信', '微信.app', 'WeChat'] : ['企业微信', '企业微信.app']
  return wechatName.includes(name)
}

function getWechatWindow(appType: AppType, windows: ActiveWindowLike[]): ActiveWindowLike | null {
  let appTargetName: string[]
  let windowTitle: string[]

  if ((appType as string) === 'whatsapp') {
    appTargetName = ['‎WhatsApp', '‎WhatsApp.app', '‎WhatsApp.exe', 'WhatsApp']
    windowTitle = ['‎WhatsApp', '‎WhatsApp.app', '‎WhatsApp.exe', 'WhatsApp']
  } else {
    appTargetName =
      appType === 'wechat' ? ['微信', '微信.app', 'WeChat'] : ['企业微信', '企业微信.app']
    windowTitle = appType === 'wechat' ? ['微信', 'Weixin'] : ['企业微信']
  }

  const allWechatWindows = windows.filter((window) =>
    appTargetName.includes(window.owner?.name ?? '')
  )

  if (allWechatWindows.length > 1) {
    const selected = allWechatWindows.find((window) => windowTitle.includes(window.title ?? ''))
    return selected ?? null
  }
  if (allWechatWindows.length === 1) {
    return allWechatWindows[0]
  }
  return null
}

async function getWechatWindowInWin(appType: AppType): Promise<ActiveWindowLike | null> {
  try {
    const { windowManager } = runtimeRequire('node-window-manager') as {
      windowManager: WindowManagerLike
    }
    const activeWechatWindow = windowManager.getActiveWindow()
    if (
      activeWechatWindow &&
      typeof activeWechatWindow.getTitle === 'function' &&
      matchWechatType(activeWechatWindow.getTitle(), appType)
    ) {
      return activeWechatWindow
    }
    const foundWindow = windowManager
      .getWindows()
      .find(
        (window) =>
          typeof window.getTitle === 'function' &&
          matchWechatType(window.getTitle(), appType) &&
          window.isVisible?.()
      )
    return foundWindow || null
  } catch (err: unknown) {
    console.error('[window-utils] getWechatWindowInWin error:', getErrorMessage(err))
    return null
  }
}

async function getWechatWindowInMac(appType: AppType): Promise<ActiveWindowLike | null> {
  const windows = await getOpenWindowsSafe()
  if (!windows || windows.length === 0) {
    return null
  }
  return getWechatWindow(appType, windows)
}

function getWindowBounds(window: ActiveWindowLike): PartialWindowBounds | null {
  if (typeof window.getBounds === 'function') {
    return window.getBounds()
  }
  if (window.bounds) {
    return window.bounds
  }
  return null
}

function validateWindowBounds(bounds: PartialWindowBounds | null): bounds is WindowBounds {
  if (!bounds) return false
  if (
    bounds.x === undefined ||
    bounds.y === undefined ||
    !bounds.width ||
    !bounds.height ||
    (bounds.width && bounds.width < 100) ||
    (bounds.height && bounds.height < 100)
  ) {
    return false
  }
  const isVisible = bounds.width > 0 && bounds.height > 0
  return isVisible
}

interface WechatWindowInfoCache {
  result: WindowInfoResult | null
  timestamp: number
}
const WINDOW_INFO_CACHE_DURATION = 5000 // 5 seconds cache
const wechatWindowInfoCache = new Map<AppType, WechatWindowInfoCache>()
const wechatWindowInfoPendingPromises = new Map<AppType, Promise<WindowInfoResult | null>>()

export async function getWechatWindowInfo(appType: AppType): Promise<WindowInfoResult | null> {
  const cached = wechatWindowInfoCache.get(appType)
  const now = Date.now()
  if (cached && now - cached.timestamp < WINDOW_INFO_CACHE_DURATION) {
    return cached.result
  }

  const pendingPromise = wechatWindowInfoPendingPromises.get(appType)
  if (pendingPromise) return pendingPromise

  const queryPromise = (async (): Promise<WindowInfoResult | null> => {
    try {
      const wechatWindow = IS_WINDOWS
        ? await getWechatWindowInWin(appType)
        : IS_MAC
          ? await getWechatWindowInMac(appType)
          : null
      if (!wechatWindow) return null

      const bounds = getWindowBounds(wechatWindow)
      if (!validateWindowBounds(bounds)) return null

      const display = screen.getDisplayMatching({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      })

      const result = {
        wechatWindow,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        wechatType: appType,
        display: { id: display.id, scaleFactor: display.scaleFactor, bounds: display.bounds }
      }
      wechatWindowInfoCache.set(appType, { result, timestamp: Date.now() })
      return result
    } catch (e) {
      console.error('getWechatWindowInfo error:', e)
      return null
    } finally {
      wechatWindowInfoPendingPromises.delete(appType)
    }
  })()

  wechatWindowInfoPendingPromises.set(appType, queryPromise)
  return queryPromise
}

export const getWindowInfo = async (
  appType: AppType = 'wechat',
  includeScreenshot: boolean = true
): Promise<{
  wechatWindow: ActiveWindowLike
  bounds: WindowBounds
  wechatType: AppType
  scaleFactor: number
  screenshot?: string
} | null> => {
  if (!includeScreenshot) {
    const result = await getWechatWindowInfo(appType)
    if (!result) return null
    return {
      wechatWindow: result.wechatWindow,
      bounds: result.bounds,
      wechatType: result.wechatType,
      scaleFactor: result.display.scaleFactor
    }
  }

  try {
    const windowCore = await getWechatWindowInfo(appType)
    if (!windowCore) return null

    const result = await captureWechatWindow(appType)
    if (!result.success || !result.screenshotBase64 || !result.bounds) return null

    return {
      wechatWindow: windowCore.wechatWindow,
      bounds: result.bounds,
      wechatType: windowCore.wechatType,
      scaleFactor: result.display?.scaleFactor ?? 1,
      screenshot: result.screenshotBase64
    }
  } catch (error) {
    console.error('getWindowInfo failure:', error)
    return null
  }
}

/**
 * 同步获取窗口信息（从内存缓存读取，不发起系统调用）
 * 前提：measureLayout 时已经调过 getWindowInfo/getWechatWindowInfo，缓存有数据
 */
export function getWindowInfoSync(appType: AppType): {
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
} | null {
  const cached = wechatWindowInfoCache.get(appType)
  if (!cached?.result) return null

  return {
    bounds: cached.result.bounds,
    scaleFactor: cached.result.display?.scaleFactor || 1
  }
}
