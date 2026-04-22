import { RPADevice } from '../../rpa-device'

export async function runReplyTest() {
  console.log('[Test] Running reply atom...')
  const device = new RPADevice()
  device.setAppType('wechat')
  
  try {
    await device.sendMessage('这是一条自动化核心测试安全回复')
    console.log('✅ Reply sent successfully')
  } catch (error) {
    console.error('❌ Reply failed', error)
  }
}
