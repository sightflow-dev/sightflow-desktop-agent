import { systemPreferences, desktopCapturer } from 'electron'

export async function checkAndRequestPermissions(): Promise<void> {
  if (process.platform !== 'darwin') {
    return
  }

  try {
    // 1. 检查并请求辅助功能权限 (Accessibility)
    const isAccessibilityGranted = systemPreferences.isTrustedAccessibilityClient(false)
    if (!isAccessibilityGranted) {
      console.log('[Permission] 辅助功能权限未授权，正在请求...')
      // 传递 true 会弹出 macOS 系统授权提示框
      systemPreferences.isTrustedAccessibilityClient(true)
    } else {
      console.log('[Permission] 已获取辅助功能权限')
    }

    // 2. 检查并请求屏幕录制/截图权限 (Screen Capture)
    const screenStatus = systemPreferences.getMediaAccessStatus('screen')
    if (screenStatus !== 'granted') {
      console.log(`[Permission] 当前屏幕录制权限状态: ${screenStatus}，正在发起请求...`)
      // 在 macOS 上，申请屏幕录制权限通常通过尝试调用 desktopCapturer
      try {
        // 加入超时机制，防止底层 macOS API 在请求授权时死锁或卡住，这在某些环境下可能发生
        await Promise.race([
          desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('请求屏幕录制权限触发超时')), 5000)
          )
        ])
        console.log('[Permission] 已触发屏幕录制权限请求')
      } catch (error) {
        console.warn('[Permission] 触发屏幕录制权限时遇到异常 or 超时:', error)
      }
    } else {
      console.log('[Permission] 已获取屏幕录制权/截图权限')
    }
  } catch (error) {
    console.error('[Permission] 检查/请求权限时发生意外错误:', error)
  }
}
