import * as assert from 'node:assert/strict'
import { GenericChannelSession, createInitialGenericChannelState } from '../src/core/generic-channel-session'
import type { DesktopDevice } from '../src/core/device'
import type { ChannelContext, ProviderEvent, SessionEvent } from '../src/core/session-types'

class FakeDevice implements DesktopDevice {
  actions: string[] = []

  setAppType(): void {}

  setApiKey(): void {}

  async measureLayout(): Promise<{ success: boolean; error?: string }> {
    return { success: true }
  }

  async screenshot(): Promise<string> {
    return 'data:image/png;base64,fake'
  }

  async hasUnreadMessage(): Promise<{
    hasUnread: boolean
    chatEntranceArea?: { bbox: any; coordinates: [number, number] }
  }> {
    return { hasUnread: false }
  }

  async isChatContactUnread(): Promise<{
    isUnread: boolean
    firstContactCoords?: [number, number]
  }> {
    return { isUnread: false }
  }

  clearUnreadCache(): void {}

  async setChatBaseline(): Promise<boolean> {
    this.actions.push('setChatBaseline')
    return true
  }

  async hasChatAreaChanged(): Promise<{ hasDiff: boolean; hasBaseline: boolean }> {
    return { hasDiff: false, hasBaseline: true }
  }

  clearChatBaseline(): void {}

  async sendMessage(text: string): Promise<void> {
    this.actions.push(`sendMessage:${text}`)
  }

  async fillDraft(text: string): Promise<void> {
    this.actions.push(`fillDraft:${text}`)
  }

  async activeUnreadByClick(): Promise<void> {}

  async clickUnreadContact(): Promise<void> {}

  async clickAt(): Promise<void> {}
}

async function runDraftScenario() {
  const device = new FakeDevice()
  const session = new GenericChannelSession(device)
  const queued: SessionEvent[] = []
  const providerEvents: ProviderEvent[] = [{ type: 'reply_text', content: 'draft text' }]

  const ctx: ChannelContext<any> = {
    appType: 'wechat',
    state: createInitialGenericChannelState(),
    host: {
      enqueue: (event) => queued.push(event),
      schedule: (event) => queued.push(event),
      runProvider: async function* () {
        yield* providerEvents
      },
      log: () => {},
      isRunning: () => true,
      stopSession: async () => {}
    }
  }

  await session.onEvent({ type: 'provider.reply_text', content: 'draft text' }, ctx)

  assert.deepEqual(device.actions, ['fillDraft:draft text', 'setChatBaseline'])
  assert.equal(queued.at(-1)?.type, 'check_unread')
}

runDraftScenario()
  .then(() => {
    console.log('generic-channel-session draft behavior check passed')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
