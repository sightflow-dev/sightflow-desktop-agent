import { AIClient } from '../../ai-client'
import { detectUnreadArea } from '../vision-utils'
import { AppType } from '../types'

export async function runVlmParallelTest(apiKey: string, appType: AppType = 'wechat') {
  const aiClient = new AIClient({ apiKey })

  console.log('[Test] 单独调 detectUnreadArea，计时开始...')
  const t = Date.now()
  try {
    const result = await detectUnreadArea(aiClient, appType)
    const elapsed = ((Date.now() - t) / 1000).toFixed(1)
    console.log(`[Test] detectUnreadArea ${result.success ? '✓' : '✗'} (${elapsed}s)`)
    if (!result.success) console.log('[Test] error:', result.error)
    return { success: result.success, elapsed, error: result.error }
  } catch (e: any) {
    const elapsed = ((Date.now() - t) / 1000).toFixed(1)
    console.error(`[Test] detectUnreadArea 异常 (${elapsed}s):`, e?.message)
    return { success: false, elapsed, error: e?.message }
  }
}
