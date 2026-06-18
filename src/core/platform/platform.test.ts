import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { pasteHotkey, primaryModifier, toOsPlatform, windowLogicalToScreen } from './platform'

test('toOsPlatform: 归一化 node platform', () => {
  assert.equal(toOsPlatform('darwin'), 'mac')
  assert.equal(toOsPlatform('win32'), 'windows')
  assert.equal(toOsPlatform('linux'), 'linux')
})

test('primaryModifier: mac=command，其它=control', () => {
  assert.equal(primaryModifier('mac'), 'command')
  assert.equal(primaryModifier('windows'), 'control')
  assert.equal(primaryModifier('linux'), 'control')
})

test('pasteHotkey: V + 主修饰键', () => {
  assert.deepEqual(pasteHotkey('mac'), { key: 'v', modifiers: ['command'] })
  assert.deepEqual(pasteHotkey('windows'), { key: 'v', modifiers: ['control'] })
})

test('windowLogicalToScreen: mac/linux 用逻辑像素，不乘 scaleFactor', () => {
  const origin = { x: 100, y: 200 }
  assert.deepEqual(windowLogicalToScreen(50, 60, origin, 2, 'mac'), [150, 260])
  assert.deepEqual(windowLogicalToScreen(50, 60, origin, 2, 'linux'), [150, 260])
})

test('windowLogicalToScreen: windows 用物理像素，(原点+偏移)×scaleFactor', () => {
  const origin = { x: 100, y: 200 }
  // (100+50)*2=300, (200+60)*2=520
  assert.deepEqual(windowLogicalToScreen(50, 60, origin, 2, 'windows'), [300, 520])
  // scaleFactor=1 时两平台一致
  assert.deepEqual(windowLogicalToScreen(50, 60, origin, 1, 'windows'), [150, 260])
})

test('windowLogicalToScreen: 与历史 vision-utils 公式逐位一致（回归保护）', () => {
  // 复刻旧 bboxToScreenCoords：bbox 中心 → 逻辑像素 → 屏幕坐标
  const bounds = { x: 80, y: 120, width: 1000, height: 800 }
  const bbox = [100, 200, 300, 400] as const
  const logicalX = ((bbox[0] + bbox[2]) / 2 / 1000) * bounds.width // 200
  const logicalY = ((bbox[1] + bbox[3]) / 2 / 1000) * bounds.height // 240
  const scale = 1.5

  // 旧 mac 分支：round(bounds.x+logicalX), round(bounds.y+logicalY)
  assert.deepEqual(windowLogicalToScreen(logicalX, logicalY, bounds, scale, 'mac'), [
    Math.round(bounds.x + logicalX),
    Math.round(bounds.y + logicalY)
  ])
  // 旧 windows 分支：round((bounds.x+logicalX)*scale), round((bounds.y+logicalY)*scale)
  assert.deepEqual(windowLogicalToScreen(logicalX, logicalY, bounds, scale, 'windows'), [
    Math.round((bounds.x + logicalX) * scale),
    Math.round((bounds.y + logicalY) * scale)
  ])
})
