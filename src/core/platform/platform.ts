// src/core/platform/platform.ts
// 跨平台收口 —— 把散落在 input-utils / vision-utils / window-utils 里的
// `IS_WINDOWS / IS_MAC` 分支决策集中到一处纯函数，配 mac/win parity 单测。
//
// 设计原则：决策（用哪个修饰键、坐标怎么换算）是纯函数且显式接收 platform 参数，
// 因此能在任意 OS 上对「mac 与 windows 两种行为」一起单测；实际的 robotjs 调用仍留在
// input-utils，只是改成调用这里的决策，不改变运行时行为。

export type OsPlatform = 'mac' | 'windows' | 'linux'

/** 把 node 的 process.platform 归一化成三态 */
export function toOsPlatform(nodePlatform: NodeJS.Platform): OsPlatform {
  if (nodePlatform === 'darwin') return 'mac'
  if (nodePlatform === 'win32') return 'windows'
  return 'linux'
}

export function currentPlatform(): OsPlatform {
  return toOsPlatform(process.platform)
}

/**
 * 主修饰键：mac 用 command，其它平台用 control。
 * 用于粘贴（Cmd/Ctrl+V）等快捷键。
 */
export function primaryModifier(platform: OsPlatform = currentPlatform()): 'command' | 'control' {
  return platform === 'mac' ? 'command' : 'control'
}

/** 粘贴快捷键描述（key + 修饰键），供 robotjs keyTap 直接消费 */
export function pasteHotkey(platform: OsPlatform = currentPlatform()): {
  key: 'v'
  modifiers: Array<'command' | 'control'>
} {
  return { key: 'v', modifiers: [primaryModifier(platform)] }
}

/**
 * 窗口内逻辑坐标 → 屏幕绝对坐标（robotjs 入参）。
 *
 * 关键平台差异（与历史 vision-utils.bboxToScreenCoords 行为完全一致）：
 * - Windows：robotjs 用物理像素，(窗口原点 + 窗口内逻辑偏移) 整体 × scaleFactor
 * - macOS / Linux：robotjs 用逻辑像素，直接相加，不乘 scaleFactor
 *
 * @param logicalX 窗口内逻辑像素 X（相对窗口左上角）
 * @param logicalY 窗口内逻辑像素 Y
 * @param origin   窗口左上角的逻辑屏幕坐标 { x, y }
 * @param scaleFactor 显示器缩放因子
 */
export function windowLogicalToScreen(
  logicalX: number,
  logicalY: number,
  origin: { x: number; y: number },
  scaleFactor: number,
  platform: OsPlatform = currentPlatform()
): [number, number] {
  if (platform === 'windows') {
    return [
      Math.round((origin.x + logicalX) * scaleFactor),
      Math.round((origin.y + logicalY) * scaleFactor)
    ]
  }
  return [Math.round(origin.x + logicalX), Math.round(origin.y + logicalY)]
}
