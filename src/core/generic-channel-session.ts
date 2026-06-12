// src/core/generic-channel-session.ts
// 通用 ChannelSession — 驱动 DesktopDevice，具体位置来源由设备测量后写入 LayoutCache。
//
// 设计原则：本文件只依赖 DesktopDevice 接口。所有微信特定的行为（如 layoutCache 清理、
// VLM bbox 状态同步）都封装到具体设备的 onSessionStart / onSessionStop / clearUnreadCache
// 里，使 channel session 在不同设备之间真正可复用。

import { DesktopDevice } from './device'
import { ChannelContext, ChannelSession, ProviderEvent, SessionEvent } from './session-types'

export interface GenericChannelState {
  measuredAt: number | null
  latestChatBaseline: number | null
}

export function createInitialGenericChannelState(): GenericChannelState {
  return {
    measuredAt: null,
    latestChatBaseline: null
  }
}

export class GenericChannelSession implements ChannelSession<GenericChannelState> {
  private readonly retryDelayMs = 5000
  private consecutiveUnreadFailures = 0

  constructor(private readonly device: DesktopDevice) {}

  async onStart(ctx: ChannelContext<GenericChannelState>): Promise<void> {
    this.device.setAppType(ctx.appType)
    this.device.clearChatBaseline()
    this.consecutiveUnreadFailures = 0
    this.resetState(ctx.state)
    await this.device.onSessionStart?.()
    ctx.host.enqueue({ type: 'bootstrap' })
  }

  async onStop(ctx: ChannelContext<GenericChannelState>): Promise<void> {
    this.device.clearChatBaseline()
    this.consecutiveUnreadFailures = 0
    await this.device.onSessionStop?.()
    this.resetState(ctx.state)
  }

  async onEvent(event: SessionEvent, ctx: ChannelContext<GenericChannelState>): Promise<void> {
    this.device.setAppType(ctx.appType)

    switch (event.type) {
      case 'bootstrap': {
        ctx.host.log('thinking', '正在识别聊天窗口布局...')
        const measureStart = Date.now()
        const result = await this.device.measureLayout()

        if (!result.success) {
          ctx.host.log('error', `${result.error || '界面识别失败'}，引擎无法启动`)
          ctx.host.trace({
            phase: 'observe',
            summary: '识别聊天窗口布局',
            action: { kind: 'measure' },
            outcome: {
              status: 'fail',
              detail: result.error || '界面识别失败',
              latencyMs: Date.now() - measureStart
            }
          })
          await ctx.host.stopSession('bootstrap_failed')
          return
        }

        ctx.state.measuredAt = Date.now()
        ctx.host.log('thinking', '聊天窗口识别完成')
        ctx.host.trace({
          phase: 'observe',
          summary: '识别聊天窗口布局',
          action: { kind: 'measure' },
          outcome: { status: 'ok', latencyMs: Date.now() - measureStart }
        })
        ctx.host.enqueue({ type: 'observe_chat' })
        break
      }

      case 'observe_chat': {
        const screenshot = await this.device.screenshot()
        ctx.host.trace({
          phase: 'observe',
          summary: '截取当前聊天窗口',
          screenshotBase64: screenshot
        })
        void this.forwardProviderEvents(screenshot, ctx)
        break
      }

      case 'provider.thinking':
        ctx.host.log('thinking', event.content)
        ctx.host.trace({
          phase: 'think',
          summary: event.content,
          reasoning: { content: event.content }
        })
        break

      case 'provider.reply_text': {
        const sendStart = Date.now()
        await this.device.sendMessage(event.content)
        ctx.host.log('reply', event.content)
        ctx.host.trace({
          phase: 'act',
          summary: '发送回复',
          action: { kind: 'send', payload: event.content },
          outcome: { status: 'ok', latencyMs: Date.now() - sendStart }
        })
        await this.device.setChatBaseline()
        ctx.state.latestChatBaseline = Date.now()
        ctx.host.enqueue({ type: 'check_unread' })
        break
      }

      case 'provider.skip':
        ctx.host.log('skip', '本轮无需回复')
        ctx.host.trace({
          phase: 'think',
          summary: '判断本轮无需回复',
          outcome: { status: 'skip' }
        })
        await this.device.setChatBaseline()
        ctx.state.latestChatBaseline = Date.now()
        ctx.host.enqueue({ type: 'check_unread' })
        break

      case 'provider.error':
        ctx.host.log('error', `回复服务异常：${event.error}`)
        ctx.host.trace({
          phase: 'think',
          summary: '回复服务异常',
          outcome: { status: 'fail', detail: event.error }
        })
        ctx.host.enqueue({
          type: 'wait_retry',
          reason: 'provider_error',
          delayMs: this.retryDelayMs
        })
        break

      case 'check_unread': {
        const diffResult = await this.device.hasChatAreaChanged()
        if (diffResult.hasDiff) {
          ctx.host.log('thinking', '检测到当前对话有新消息')
          ctx.host.trace({
            phase: 'verify',
            summary: '检测到当前对话有新消息',
            outcome: { status: 'ok' }
          })
          ctx.host.enqueue({ type: 'observe_chat' })
          break
        }

        const unreadResult = await this.device.hasUnreadMessage()
        if (!unreadResult.hasUnread) {
          ctx.host.enqueue({
            type: 'wait_retry',
            reason: 'no_unread',
            delayMs: this.retryDelayMs
          })
          break
        }

        const chatEntranceCoords = unreadResult.chatEntranceArea?.coordinates
        if (!chatEntranceCoords) {
          ctx.host.log('error', '检测到未读消息，但未找到聊天入口位置')
          ctx.host.enqueue({
            type: 'wait_retry',
            reason: 'missing_chat_entrance',
            delayMs: this.retryDelayMs
          })
          break
        }

        ctx.host.log('thinking', '检测到未读消息，正在尝试打开会话')
        ctx.host.trace({
          phase: 'act',
          summary: '点击未读会话入口',
          action: { kind: 'click', target: chatEntranceCoords },
          outcome: { status: 'ok' }
        })
        await this.device.activeUnreadByClick(chatEntranceCoords)
        await this.sleep(150 + Math.random() * 100)

        const openResult = await this.tryOpenUnreadConversation(ctx)
        if (openResult === 'opened') {
          ctx.host.enqueue({ type: 'observe_chat' })
          break
        }

        ctx.host.enqueue({
          type: 'wait_retry',
          reason: openResult,
          delayMs: this.retryDelayMs
        })
        break
      }

      case 'wait_retry':
        ctx.host.log('skip', '等待下一轮未读检测')
        ctx.host.schedule(
          event.reason === 'provider_error' ? { type: 'observe_chat' } : { type: 'check_unread' },
          event.delayMs ?? this.retryDelayMs
        )
        break
    }
  }

  private async forwardProviderEvents(
    screenshot: string,
    ctx: ChannelContext<GenericChannelState>
  ): Promise<void> {
    try {
      for await (const event of ctx.host.runProvider({
        screenshot,
        appType: ctx.appType
      })) {
        if (!ctx.host.isRunning()) break

        const sessionEvent = this.mapProviderEvent(event)
        if (sessionEvent) {
          ctx.host.enqueue(sessionEvent)
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.host.enqueue({ type: 'provider.error', error: message })
    }
  }

  private mapProviderEvent(event: ProviderEvent): SessionEvent | null {
    switch (event.type) {
      case 'thinking':
        return { type: 'provider.thinking', content: event.content }
      case 'reply_text':
        return { type: 'provider.reply_text', content: event.content }
      case 'skip':
        return { type: 'provider.skip' }
      case 'error':
        return { type: 'provider.error', error: event.error }
      default:
        return null
    }
  }

  private resetState(state: GenericChannelState): void {
    state.measuredAt = null
    state.latestChatBaseline = null
  }

  private async tryOpenUnreadConversation(
    ctx: ChannelContext<GenericChannelState>
  ): Promise<'opened' | 'contact_not_ready'> {
    let contactResult = await this.device.isChatContactUnread()

    if (!contactResult.isUnread) {
      ctx.host.log('thinking', '当前会话没有新消息，正在重新检测...')
      await this.sleep(1000)

      const recheckResult = await this.device.hasUnreadMessage()
      const recheckCoords = recheckResult.chatEntranceArea?.coordinates

      if (!recheckResult.hasUnread || !recheckCoords) {
        ctx.host.log('skip', '重新检测后无未读消息，等待下一轮')
        return 'contact_not_ready'
      }

      ctx.host.log('thinking', '仍检测到未读消息，正在再次尝试打开会话')
      await this.device.activeUnreadByClick(recheckCoords)
      await this.sleep(500)
      contactResult = await this.device.isChatContactUnread()
    }

    if (!contactResult.isUnread) {
      this.consecutiveUnreadFailures += 1

      if (this.consecutiveUnreadFailures >= 3) {
        ctx.host.log(
          'thinking',
          `连续 ${this.consecutiveUnreadFailures} 次检测失败，正在重置未读识别状态`
        )
        this.device.clearUnreadCache()
        this.consecutiveUnreadFailures = 0
        await this.sleep(500)

        contactResult = await this.device.isChatContactUnread()
        if (!contactResult.isUnread) {
          ctx.host.log('thinking', '重置后仍未成功，正在再次尝试打开会话')
          const retryUnread = await this.device.hasUnreadMessage()
          const retryCoords = retryUnread.chatEntranceArea?.coordinates

          if (!retryUnread.hasUnread || !retryCoords) {
            ctx.host.log('skip', '重置后仍未找到可用会话入口，等待下一轮')
            return 'contact_not_ready'
          }

          await this.device.activeUnreadByClick(retryCoords)
          await this.sleep(500)
          contactResult = await this.device.isChatContactUnread()

          if (!contactResult.isUnread) {
            ctx.host.log('skip', '最终检测仍失败，放弃当前轮未读切换')
            return 'contact_not_ready'
          }
        }
      } else {
        ctx.host.log(
          'skip',
          `会话切换检测失败（第 ${this.consecutiveUnreadFailures} 次），等待下一轮`
        )
        return 'contact_not_ready'
      }
    }

    this.consecutiveUnreadFailures = 0

    if (!contactResult.firstContactCoords) {
      ctx.host.log('skip', '未找到联系人位置，等待下一轮')
      return 'contact_not_ready'
    }

    ctx.host.log('thinking', '正在打开未读会话')
    ctx.host.trace({
      phase: 'act',
      summary: '打开未读会话',
      action: { kind: 'click', target: contactResult.firstContactCoords },
      outcome: { status: 'ok' }
    })
    await this.device.clickUnreadContact(contactResult.firstContactCoords)
    await this.sleep(500 + Math.random() * 300)
    this.device.clearChatBaseline()
    ctx.state.latestChatBaseline = null
    return 'opened'
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
