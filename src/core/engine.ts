// src/core/engine.ts
// 主引擎循环 — 微信自动回复的完整感知→决策→执行闭环
//
// 流程:
// 1. 启动 — 初始化 hooks + 权限 OK
// 2. 测量 — VLM 一次性定位布局（chatEntrance / firstContact / inputArea），结果缓存
// 3. 发图 — 截图当前对话
// 4. 回复 — AI 分析截图内容 + RPA 执行回复
// 5. 检查下一条 — 纯视觉红点检测 + 点击切换
//    → 有未读: 视觉点击红点 → 细检测联系人 → 点击联系人，回到步骤 3
//    → 无未读: 轮询等待，直到新消息出现

import { AgentHooks, ReplyAction, ActionItem } from './hooks'
import { DesktopDevice } from './device'

export class Engine {
  private running = false

  constructor(
    private hooks: AgentHooks,
    private device: DesktopDevice,
    private onLog?: (type: string, content: string) => void
  ) {}

  private emitLog(type: 'thinking' | 'reply' | 'skip' | 'error', content: string) {
    if (this.onLog) this.onLog(type, content)
    else console.log(`[Engine-${type}] ${content}`)
  }

  async start() {
    this.running = true
    await this.hooks.onEngineStart?.()

    // 注册外部触发器
    this.hooks.onExternalTrigger?.((params) => {
      this.executeExternalActions(params)
    })

    try {
      // ── Step 1: 测量 ──
      this.emitLog('thinking', '开始布局测量...')
      const measured = await this.device.measureLayout()

      if (!measured) {
        this.emitLog('error', '布局测量失败，引擎无法启动')
        this.running = false
        await this.hooks.onEngineStop?.()
        return
      }

      this.emitLog('thinking', '布局测量完成 ✓')

      // ── 主循环 ──
      while (this.running) {
        try {
          await this.processCurrentChat()

          if (!this.running) break

          // 处理完当前对话后，检查是否还有下一条未读
          await this.waitForNextUnread()
        } catch (e) {
          this.emitLog('error', `循环异常: ${String(e)}`)
          this.hooks.onError?.(e as Error, 'engine_loop')
          // 异常后等一段时间再重试
          await this.sleep(3000 + Math.random() * 2000)
        }
      }
    } catch (e) {
      this.emitLog('error', `引擎启动失败: ${String(e)}`)
      this.hooks.onError?.(e as Error, 'engine_start')
    }

    await this.hooks.onEngineStop?.()
  }

  stop() {
    this.running = false
  }

  isRunning() {
    return this.running
  }

  // ── Step 3+4: 发图 → 回复 ──

  /**
   * 处理当前对话：截图 → AI 分析 → RPA 执行回复
   */
  private async processCurrentChat() {
    // 发图
    const screenshot = await this.device.screenshot()
    this.emitLog('thinking', '截图完成，请求 AI 分析...')

    // 回复
    for await (const action of this.hooks.getReply({ screenshot })) {
      if (!this.running) break
      await this.executeAction(action)
    }
  }

  // ── Step 5: 纯视觉红点检测 → 点击激活 → 点击联系人 ──

  /**
   * 等待下一条未读消息（纯视觉路线，参考 whatsapp-agent-demo 的 receiveNewNessageRPA）
   *
   * 流程:
   * 1. 粗检测：检测聊天入口红点（hasUnreadMessage）
   * 2. 如果有未读 → 点击红点区域激活未读列表（activeUnreadByClick）
   * 3. 细检测：检测联系人头像红点（isChatContactUnread）
   * 4. 如果联系人有红点 → 点击联系人进入对话（clickUnreadContact）
   * 5. 失败时有重试 + 缓存清除机制
   */
  private async waitForNextUnread() {
    while (this.running) {
      // 轮询间隔 3-5 秒
      await this.sleep(3000 + Math.random() * 2000)

      if (!this.running) break

      // ── Step 1: 粗检测红点 ──
      const unreadResult = await this.device.hasUnreadMessage()

      if (!unreadResult.hasUnread) {
        // 没有未读，继续轮询
        continue
      }

      // ── Step 2: 点击红点区域激活未读列表 ──
      const redDotCoordinates = unreadResult.chatEntranceArea?.coordinates
      if (!redDotCoordinates) {
        this.emitLog('error', '检测到未读但未获取到 chatEntranceArea 坐标，继续轮询')
        continue
      }

      this.emitLog('thinking', `检测到未读消息，点击红点区域 (${redDotCoordinates[0]}, ${redDotCoordinates[1]})`)
      await this.device.activeUnreadByClick(redDotCoordinates)
      await this.sleep(150 + Math.random() * 100)

      // ── Step 3: 细检测联系人红点 ──
      let contactResult = await this.device.isChatContactUnread()

      // ── Step 3.1: 首次细检测失败 → 重新粗检测 + 再次点击 ──
      if (!contactResult.isUnread) {
        this.emitLog('thinking', '当前联系人无未读消息，重新检测...')
        await this.sleep(1000)

        const recheckResult = await this.device.hasUnreadMessage()

        if (recheckResult.hasUnread) {
          this.emitLog('thinking', '仍有未读消息，再次点击红点')

          const recheckCoords = recheckResult.chatEntranceArea?.coordinates
          if (recheckCoords) {
            await this.device.activeUnreadByClick(recheckCoords)
            await this.sleep(500)

            // 再次细检测
            contactResult = await this.device.isChatContactUnread()
          }
        } else {
          this.emitLog('skip', '重新检测后无未读消息，继续轮询')
          continue
        }
      }

      // ── Step 3.2: 连续两次细检测失败 → 清除缓存强制重检 ──
      if (!contactResult.isUnread) {
        this.emitLog('thinking', '连续检测失败，VLM 坐标缓存可能不准确，清除缓存强制重检')

        this.device.clearUnreadCache()
        await this.sleep(500)

        // 重新调 isChatContactUnread（触发 VLM 重新定位 firstContact）
        contactResult = await this.device.isChatContactUnread()

        if (!contactResult.isUnread) {
          // 缓存重建后仍失败 → 再点击一次 + 最终检测
          this.emitLog('thinking', '缓存重建后检测失败，再点击一次')

          const retryUnread = await this.device.hasUnreadMessage()
          const retryCoords = retryUnread.chatEntranceArea?.coordinates

          if (retryCoords) {
            await this.device.activeUnreadByClick(retryCoords)
            await this.sleep(500)

            contactResult = await this.device.isChatContactUnread()

            if (!contactResult.isUnread) {
              this.emitLog('skip', '最终检测仍失败，放弃，继续轮询')
              continue
            }
          } else {
            this.emitLog('skip', '缓存重建后未获取到坐标，继续轮询')
            continue
          }
        }
      }

      // ── Step 4: 点击未读联系人 ──
      const firstContactCoords = contactResult.firstContactCoords
      if (!firstContactCoords) {
        this.emitLog('skip', '未获取到 firstContact 坐标，继续轮询')
        continue
      }

      this.emitLog('thinking', `点击联系人 (${firstContactCoords[0]}, ${firstContactCoords[1]})`)
      await this.device.clickUnreadContact(firstContactCoords)
      await this.sleep(500 + Math.random() * 300)

      // 成功切换 → 回到主循环 processCurrentChat
      return
    }
  }

  // ── 执行动作 ──

  private async executeAction(action: ReplyAction) {
    try {
      switch (action.type) {
        case 'text':
          this.emitLog('reply', `[回复] ${action.content}`)
          await this.device.sendMessage(action.content)
          this.hooks.onActionComplete?.(
            { type: 'text', content: action.content } as ActionItem,
            { success: true }
          )
          break
        case 'image':
          // TODO: 图片发送
          break
        case 'thinking':
          this.emitLog('thinking', action.content)
          break
        case 'skip':
          this.emitLog('skip', '跳过回复')
          break
      }
    } catch (e) {
      this.emitLog('error', `执行动作失败: ${String(e)}`)
      this.hooks.onError?.(e as Error, 'execute_action')
    }
  }

  private async executeExternalActions(params: {
    actions: ActionItem[]
    targets?: string[]
  }) {
    if (this.hooks.executeActions) {
      for await (const result of this.hooks.executeActions(params)) {
        console.log('[Engine] External action result:', result)
      }
    }
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
