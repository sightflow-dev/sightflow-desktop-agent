import { RPADevice } from '../../rpa-device'

export async function runReplyTest() {
  console.log('[Test] Running reply atom...')
  const device = new RPADevice()
  device.setAppType('weixin')
  
  const result = await device.sendReply('这是一条自动化核心测试安全回复')
  if (result) {
    console.log('✅ Reply sent successfully')
  } else {
    console.error('❌ Reply failed')
  }
}
