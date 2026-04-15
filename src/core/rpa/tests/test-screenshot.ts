import { RPADevice } from '../../rpa-device'
import * as fs from 'fs'

export async function runScreenshotTest() {
  console.log('[Test] Running screenshot atom...')
  const device = new RPADevice()
  device.setAppType('weixin')
  
  const result = await device.captureAppScope()
  if (result.success && result.screenshot) {
    const base64Data = result.screenshot.replace(/^data:image\/\w+;base64,/, '')
    fs.writeFileSync('test-screenshot.png', Buffer.from(base64Data, 'base64'))
    console.log(`✅ Screenshot saved to test-screenshot.png (Size: ${result.screenshot.length})`)
  } else {
    console.error('❌ Screenshot failed', result.error)
  }
}
