import { RPADevice } from '../../rpa-device'

export async function runSwitchTest() {
  console.log('[Test] Running visual unread switch test...')
  const device = new RPADevice()
  device.setAppType('wechat')
  
  // 1. 检测未读
  const unreadResult = await device.hasUnreadMessage()
  if (!unreadResult.hasUnread || !unreadResult.chatEntranceArea) {
    console.log('❌ 未检测到未读消息')
    return
  }

  console.log('✅ 检测到未读，点击红点...')

  // 2. 点击红点
  await device.activeUnreadByClick(unreadResult.chatEntranceArea.coordinates)

  // 3. 细检测联系人
  const contactResult = await device.isChatContactUnread()
  if (!contactResult.isUnread || !contactResult.firstContactCoords) {
    console.log('❌ 联系人未检测到未读红点')
    return
  }

  console.log('✅ 联系人有红点，点击联系人...')

  // 4. 点击联系人
  await device.clickUnreadContact(contactResult.firstContactCoords)
  console.log('✅ 视觉切换未读完成')
}
