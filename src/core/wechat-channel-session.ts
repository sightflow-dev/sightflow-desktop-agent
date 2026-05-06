import { RPADevice } from './rpa-device'
import { clearLayoutCache, getInputAreaFromCache, getLayoutCache } from './rpa/vision-utils'
import { ChannelContext, ChannelSession, ProviderEvent, SessionEvent } from './session-types'

export interface WeChatChannelState {
  searchInputBox: { bbox: [number, number, number, number]; coordinates: [number, number] } | null
  messageInputArea: { bbox: [number, number, number, number]; coordinates: [number, number] } | null
  chatEntranceArea: { bbox: [number, number, number, number]; coordinates: [number, number] } | null
  firstContact: { bbox: [number, number, number, number]; coordinates: [number, number] } | null
  chatMainArea: { bbox: [number, number, number, number]; coordinates: [number, number] } | null
  latestChatBaseline: number | null
  measuredAt: number | null
}

export function createInitialWeChatChannelState(): WeChatChannelState {
  return {
    searchInputBox: null,
    messageInputArea: null,
    chatEntranceArea: null,
    firstContact: null,
    chatMainArea: null,
    latestChatBaseline: null,
    measuredAt: null
  }
}

export class WeChatChannelSession implements ChannelSession<WeChatChannelState> {
  private readonly retryDelayMs = 5000
  private consecutiveUnreadFailures = 0

  constructor(private readonly device: RPADevice) {}

  async onStart(ctx: ChannelContext<WeChatChannelState>): Promise<void> {
    this.device.setAppType(ctx.appType)
    this.device.clearChatBaseline()
    this.consecutiveUnreadFailures = 0
    this.resetState(ctx.state)
    ctx.host.enqueue({ type: 'bootstrap' })
  }

  async onStop(ctx: ChannelContext<WeChatChannelState>): Promise<void> {
    this.device.clearChatBaseline()
    this.consecutiveUnreadFailures = 0
    clearLayoutCache(ctx.appType)
    this.resetState(ctx.state)
  }

  async onEvent(event: SessionEvent, ctx: ChannelContext<WeChatChannelState>): Promise<void> {
    this.device.setAppType(ctx.appType)

    switch (event.type) {
      case 'bootstrap': {
        ctx.host.log('thinking', '正在识别聊天窗口布局...')
        const result = await this.device.measureLayout()

        if (!result.success) {
          ctx.host.log('error', `${result.error || '界面识别失败'}，引擎无法启动`)
          await ctx.host.stopSession('bootstrap_failed')
          return
        }

        this.syncStateFromCache(ctx)
        ctx.host.log('thinking', '聊天窗口识别完成')
        ctx.host.enqueue({ type: 'observe_chat' })
        break
      }

      case 'observe_chat': {
        const screenshot = await this.device.screenshot()
        this.syncStateFromCache(ctx)
        void this.forwardProviderEvents(screenshot, ctx)
        break
      }

      case 'provider.thinking':
        ctx.host.log('thinking', event.content)
        break

      case 'provider.reply_text':
        await this.device.sendMessage(event.content)
        ctx.host.log('reply', event.content)
        await this.device.setChatBaseline()
        ctx.state.latestChatBaseline = Date.now()
        ctx.host.enqueue({ type: 'check_unread' })
        break

      case 'provider.skip':
        ctx.host.log('skip', '本轮无需回复')
        await this.device.setChatBaseline()
        ctx.state.latestChatBaseline = Date.now()
        ctx.host.enqueue({ type: 'check_unread' })
        break

      case 'provider.error':
        ctx.host.log('error', `回复服务异常：${event.error}`)
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

        ctx.host.log(
          'thinking',
          '检测到未读消息，正在尝试打开会话'
        )
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
          event.reason === 'provider_error'
            ? { type: 'observe_chat' }
            : { type: 'check_unread' },
          event.delayMs ?? this.retryDelayMs
        )
        break
    }
  }

  private async forwardProviderEvents(
    screenshot: string,
    ctx: ChannelContext<WeChatChannelState>
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
    } catch (error: any) {
      ctx.host.enqueue({
        type: 'provider.error',
        error: error?.message || String(error)
      })
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

  private syncStateFromCache(ctx: ChannelContext<WeChatChannelState>): void {
    const cache = getLayoutCache(ctx.appType)
    ctx.state.searchInputBox = cache?.searchInputBox || null
    ctx.state.chatEntranceArea = cache?.chatEntranceArea || null
    ctx.state.firstContact = cache?.firstContact || null
    ctx.state.chatMainArea = cache?.chatMainArea || null
    ctx.state.messageInputArea = getInputAreaFromCache(ctx.appType)
    ctx.state.measuredAt = Date.now()
  }

  private resetState(state: WeChatChannelState): void {
    state.searchInputBox = null
    state.messageInputArea = null
    state.chatEntranceArea = null
    state.firstContact = null
    state.chatMainArea = null
    state.latestChatBaseline = null
    state.measuredAt = null
  }

  private async tryOpenUnreadConversation(
    ctx: ChannelContext<WeChatChannelState>
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
