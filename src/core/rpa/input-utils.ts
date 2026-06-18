import { clipboard } from 'electron'
import { AppType } from './types'
import { getWindowInfo } from './window-utils'
import { getInputAreaFromCache } from './vision-utils'
import { primaryModifier } from '../platform/platform'
const IS_WINDOWS = process.platform === 'win32'

import { delay, randomDelayIn, getRobot } from './util'

// 原版 whatsapp-agent-demo 的贝塞尔曲线仿人滑动
async function humanLikeMove(
  targetX: number,
  targetY: number,
  options: {
    minSteps?: number
    maxSteps?: number
    baseDelay?: number
  } = {}
): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const { minSteps = 5, maxSteps = 15, baseDelay = 2 } = options

  const startPos = robot.getMousePos()
  const dx = targetX - startPos.x
  const dy = targetY - startPos.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  if (distance < 1) {
    robot.moveMouse(Math.round(targetX), Math.round(targetY))
    return
  }

  // 根据距离决定步数
  const steps = Math.min(
    maxSteps,
    Math.max(minSteps, Math.floor(distance / 40) + Math.floor(Math.random() * 3))
  )

  // 生成贝塞尔曲线控制点 (Cubic Bezier)
  const ctrl1X = startPos.x + dx * Math.random() * 0.5 + (Math.random() - 0.5) * distance * 0.2
  const ctrl1Y = startPos.y + dy * Math.random() * 0.5 + (Math.random() - 0.5) * distance * 0.2
  const ctrl2X =
    startPos.x + dx * (0.5 + Math.random() * 0.5) + (Math.random() - 0.5) * distance * 0.2
  const ctrl2Y =
    startPos.y + dy * (0.5 + Math.random() * 0.5) + (Math.random() - 0.5) * distance * 0.2

  for (let i = 1; i <= steps; i++) {
    const t = i / steps

    // 匀速转非线性 (Ease Out)
    const easeT = t * (2 - t)

    const mt = 1 - easeT
    const mt2 = mt * mt
    const mt3 = mt2 * mt
    const easeT2 = easeT * easeT
    const easeT3 = easeT2 * easeT

    // 贝塞尔曲线公式计算
    const x =
      mt3 * startPos.x + 3 * mt2 * easeT * ctrl1X + 3 * mt * easeT2 * ctrl2X + easeT3 * targetX
    const y =
      mt3 * startPos.y + 3 * mt2 * easeT * ctrl1Y + 3 * mt * easeT2 * ctrl2Y + easeT3 * targetY

    // 加入随机细微抖动 (±1像素)
    const jitterX = i === steps ? 0 : (Math.random() - 0.5) * 2
    const jitterY = i === steps ? 0 : (Math.random() - 0.5) * 2

    robot.moveMouse(Math.round(x + jitterX), Math.round(y + jitterY))

    // 变频延迟，模拟人类微停顿
    let stepDelay = baseDelay + Math.random() * 2
    if (i > steps * 0.8) stepDelay += 2

    await delay(stepDelay)
  }
}

/**
 * 仿人化的鼠标点击函数
 * 将点击分解为按下和抬起，并加入随机物理按压延迟
 * @param button 鼠标按键，默认 'left'
 */
export async function humanLikeClick(button: 'left' | 'right' = 'left'): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  try {
    // 模拟按下
    robot.mouseToggle('down', button)

    // 模拟物理按压耗时 (50ms - 150ms)
    const pressDuration = 120 + Math.random() * 100
    await delay(Math.round(pressDuration))

    // 模拟抬起
    robot.mouseToggle('up', button)

    // 点击后的随机微小停顿，模拟人类反应
    const afterClickDelay = 50 + Math.random() * 100
    await delay(Math.round(afterClickDelay))
  } catch (error) {
    console.error('【拟人化点击】执行失败:', error)
    // 降级处理：如果异常，确保至少尝试点击
    robot.mouseClick(button)
  }
}

const getWeChatInputPosition = (bounds: any, scaleFactor: number) => {
  if (IS_WINDOWS) {
    const baseInputX = Math.round((bounds.x + bounds.width - 150) * scaleFactor)
    const baseInputY = Math.round((bounds.y + bounds.height - 40) * scaleFactor)
    return {
      inputX: baseInputX + (Math.random() - 0.5) * 20,
      inputY: baseInputY - Math.random() * 5
    }
  }
  const baseInputX = bounds.x + bounds.width - 250
  const baseInputY = bounds.y + bounds.height - 20
  return { inputX: baseInputX + (Math.random() - 0.5) * 20, inputY: baseInputY - Math.random() * 5 }
}

/**
 * 业务原子 2 — 核心实现：按给定坐标发送消息（不依赖 VLM 缓存）。
 * `sendReplyAction`（VLM 路线）与 `BoxSelectDevice.sendMessage`（框选路线）共用此函数。
 *
 * 1. humanLikeMove → 输入框焦点坐标 (x, y)
 * 2. 隐式鼠标左键点击聚焦
 * 3. 剪贴板 + Cmd/Ctrl+V 粘贴
 * 4. Enter 发送
 */
export async function sendReplyByCoordsAction(
  x: number,
  y: number,
  text: string
): Promise<boolean> {
  const robot = getRobot()
  if (!robot) {
    console.error('[sendReplyByCoordsAction] RobotJS 缺失')
    return false
  }

  try {
    await humanLikeMove(x, y)
    await randomDelayIn(100, 200)

    robot.mouseClick('left')
    await randomDelayIn(200, 300)

    clipboard.writeText(text)
    await randomDelayIn(50, 100)

    // 粘贴：mac=Cmd+V / win|linux=Ctrl+V（修饰键决策集中到 platform 模块）
    robot.keyTap('v', [primaryModifier()])

    await randomDelayIn(300, 500)

    robot.keyTap('enter')

    if (IS_WINDOWS) {
      robot.keyTap('enter', ['control'])
      await randomDelayIn(40, 60)
      robot.keyTap('backspace')
    } else {
      robot.keyTap('enter', ['command'])
      await randomDelayIn(20, 40)
      robot.keyToggle('command', 'up')
      await randomDelayIn(20, 40)
      robot.keyTap('backspace')
    }

    return true
  } catch (err: any) {
    console.error('[sendReplyByCoordsAction] Failed:', err)
    return false
  }
}

/**
 * 业务原子 2：极简防检测回复模式（VLM 路线适配器）。
 * 从 layout cache 中找输入框坐标，缺失时回退到经验公式，最终调用 `sendReplyByCoordsAction`。
 */
export async function sendReplyAction(appType: AppType, text: string): Promise<boolean> {
  const windowInfo = await getWindowInfo(appType, false)
  if (!windowInfo || !windowInfo.bounds) {
    console.error('[sendReplyAction] 无法获取窗口信息')
    return false
  }

  let inputX: number | undefined
  let inputY: number | undefined

  // 优先从缓存获取输入框坐标（chatMainArea 反推）
  const inputArea = getInputAreaFromCache(appType)
  if (inputArea) {
    inputX = inputArea.coordinates[0] + (Math.random() - 0.5) * 10
    inputY = inputArea.coordinates[1] + (Math.random() - 0.5) * 4
    console.log(`[sendReplyAction] 使用缓存输入框坐标: (${inputX}, ${inputY})`)
  }

  // Fallback 处理
  if (inputX === undefined || inputY === undefined) {
    console.log('[sendReplyAction] 使用 Fallback 逻辑生成输入框坐标')
    const pos = getWeChatInputPosition(windowInfo.bounds, windowInfo.scaleFactor || 1)
    inputX = pos.inputX
    inputY = pos.inputY
  }

  return sendReplyByCoordsAction(inputX, inputY, text)
}

export type ClickPolicy = 'single' | 'double'

/**
 * 默认点击策略：仅微信桌面端需要双击红点切换会话；
 * 企业微信、钉钉、飞书、Slack、Telegram 以及任何 generic 应用都用单击。
 */
export function defaultClickPolicy(appType: AppType): ClickPolicy {
  return appType === 'wechat' ? 'double' : 'single'
}

/**
 * 业务原子 3：点击红点区域激活未读消息（纯视觉路线）
 *
 * 参考 whatsapp-agent-demo 的 activeUnreadByClick：
 * - 微信场景：双击红点区域（单击只是展开，双击才会切换）
 * - 企业微信、通用 IM 场景：单击即可
 *
 * 旧签名 (coords, appType) 仍然支持；想显式指定策略时传第三个参数。
 */
export async function activeUnreadByClickAction(
  coordinates: [number, number],
  appType: AppType,
  clickPolicy?: ClickPolicy
): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const [centerX, centerY] = coordinates
  const policy: ClickPolicy = clickPolicy ?? defaultClickPolicy(appType)
  const isSingleClick = policy === 'single'

  console.log(`[activeUnreadByClick] ${isSingleClick ? '单击' : '双击'}红点`, {
    centerX,
    centerY,
    appType,
    policy
  })

  // 移动鼠标到红点中心
  await humanLikeMove(centerX, centerY)

  // 移动后的随机延迟（150-250ms）
  await randomDelayIn(150, 250)

  // 根据 policy 执行单击或双击
  robot.mouseClick('left')
  if (!isSingleClick) {
    // 双击：第二次点击
    await randomDelayIn(40, 60)
    robot.mouseClick('left')
  }
}

/**
 * 业务原子 4：点击联系人列表第一个未读联系人
 *
 * 参考 whatsapp-agent-demo 的 clickUnreadContact
 */
export async function clickUnreadContactAction(coordinates: [number, number]): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const [firstContactX, firstContactY] = coordinates
  console.log('[clickUnreadContact] 点击联系人', {
    firstContactX,
    firstContactY
  })

  // 移动鼠标到联系人位置
  await humanLikeMove(firstContactX, firstContactY)
  await randomDelayIn(150, 250)

  // 点击左键
  robot.mouseClick('left')
  console.log('[clickUnreadContact] 点击完成')
  await randomDelayIn(150, 250)
}
