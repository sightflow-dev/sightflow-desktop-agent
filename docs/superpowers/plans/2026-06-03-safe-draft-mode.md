# Safe Draft Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe draft mode that fills the chat input with AI-generated text without sending, keeps auto-send available, and avoids repeated drafting when the chat content has not changed.

**Architecture:** Keep the Provider contract unchanged and introduce `replyMode` as a first-class runtime setting. Split device actions into `fillDraft` and `sendMessage`, branch the session flow on `replyMode`, then expose the mode through the existing renderer settings and home control UI. Add a minimal behavior test harness around `GenericChannelSession` so draft and auto-send paths can be verified without spinning up Electron windows.

**Tech Stack:** Electron, React 19, TypeScript, electron-store, robotjs, ts-node

---

### Task 1: Add a runnable session behavior test harness

**Files:**
- Modify: `package.json`
- Create: `scripts/test-generic-channel-session.ts`
- Modify: `src/core/device.ts:15-99` (interface additions referenced by the harness)
- Test: `scripts/test-generic-channel-session.ts`

- [ ] **Step 1: Write the failing test harness**

```ts
// scripts/test-generic-channel-session.ts
import assert from 'node:assert/strict'
import { GenericChannelSession, createInitialGenericChannelState } from '../src/core/generic-channel-session'
import type { DesktopDevice } from '../src/core/device'
import type { ChannelContext, ProviderEvent, SessionEvent } from '../src/core/session-types'

class FakeDevice implements DesktopDevice {
  actions: string[] = []
  setAppType(): void {}
  setApiKey(): void {}
  async measureLayout() { return { success: true } }
  async screenshot() { return 'data:image/png;base64,fake' }
  async hasUnreadMessage() { return { hasUnread: false } }
  async isChatContactUnread() { return { isUnread: false } }
  clearUnreadCache(): void {}
  async setChatBaseline() { this.actions.push('setChatBaseline'); return true }
  async hasChatAreaChanged() { return { hasDiff: false, hasBaseline: true } }
  clearChatBaseline(): void {}
  async fillDraft(text: string) { this.actions.push(`fillDraft:${text}`) }
  async sendMessage(text: string) { this.actions.push(`sendMessage:${text}`) }
  async activeUnreadByClick() {}
  async clickUnreadContact() {}
  async clickAt() {}
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
      runProvider: async function* () { yield* providerEvents },
      log: () => {},
      isRunning: () => true,
      stopSession: async () => {}
    }
  }

  await session.onEvent({ type: 'provider.reply_text', content: 'draft text' }, ctx)

  assert.deepEqual(device.actions, ['fillDraft:draft text', 'setChatBaseline'])
  assert.equal(queued.at(-1)?.type, 'check_unread')
}

runDraftScenario().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: Add a package script for the harness**

```json
{
  "scripts": {
    "test:session": "ts-node --transpile-only scripts/test-generic-channel-session.ts"
  }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:session`

Expected: FAIL because `DesktopDevice` does not yet define `fillDraft`, and `GenericChannelSession` still sends replies through `sendMessage`.

- [ ] **Step 4: Commit the red test setup**

```bash
git add package.json scripts/test-generic-channel-session.ts
git commit -m "新增安全起草模式失败测试"
```

### Task 2: Add reply mode configuration and split device actions

**Files:**
- Modify: `src/main/index.ts:40-127,372-381,485-501`
- Modify: `src/core/device.ts:15-99`
- Modify: `src/core/rpa/input-utils.ts:103-197`
- Modify: `src/core/rpa-device.ts:1-220`
- Modify: `src/core/box-select-device.ts:1-202`
- Modify: `src/core/mock-device.ts:1-71`
- Modify: `src/renderer/src/App.tsx:6-18,123-136`
- Test: `npm run test:session`

- [ ] **Step 1: Extend settings and shared renderer types with `replyMode`**

```ts
// src/main/index.ts
type ReplyMode = 'draft' | 'auto-send'

interface AppSettings {
  locale: 'zh' | 'en'
  appType: AppType
  replyMode: ReplyMode
  vision: { apiKey: string }
  chatProvider: { manifestUrl: string; installed: InstalledProviderInfo | null; config: Record<string, any> }
  defaultCaptureStrategy: CaptureStrategy
  capture: Partial<Record<AppType, PerAppCapture>>
}

const settingsStore = new StoreClass({
  name: 'settings',
  defaults: {
    locale: 'zh',
    appType: 'wechat',
    replyMode: 'draft',
    vision: { apiKey: '' },
    chatProvider: { manifestUrl: '', installed: null, config: {} },
    defaultCaptureStrategy: 'auto',
    capture: {}
  }
})
```

```ts
// src/renderer/src/App.tsx
type ReplyMode = 'draft' | 'auto-send'

interface AppSettings {
  locale: 'zh' | 'en'
  appType: AppType
  replyMode: ReplyMode
  vision: { apiKey: string }
  chatProvider: {
    manifestUrl: string
    installed: InstalledProviderInfo | null
    config: Record<string, any>
  }
  defaultCaptureStrategy: CaptureStrategy
  capture: Partial<Record<AppType, PerAppCapture>>
}
```

- [ ] **Step 2: Add `fillDraft` to the device interface**

```ts
// src/core/device.ts
export interface DesktopDevice {
  setAppType(appType: AppType): void
  setApiKey(apiKey: string): void
  onSessionStart?(): Promise<void> | void
  onSessionStop?(): Promise<void> | void
  measureLayout(): Promise<{ success: boolean; error?: string }>
  screenshot(): Promise<string>
  hasUnreadMessage(): Promise<{ hasUnread: boolean; chatEntranceArea?: { bbox: BBox; coordinates: [number, number] } }>
  isChatContactUnread(): Promise<{ isUnread: boolean; firstContactCoords?: [number, number] }>
  clearUnreadCache(): void
  setChatBaseline(): Promise<boolean>
  hasChatAreaChanged(): Promise<{ hasDiff: boolean; hasBaseline: boolean }>
  clearChatBaseline(): void
  fillDraft(text: string): Promise<void>
  sendMessage(text: string): Promise<void>
  activeUnreadByClick(coordinates: [number, number]): Promise<void>
  clickUnreadContact(coordinates: [number, number]): Promise<void>
  clickAt(x: number, y: number): Promise<void>
}
```

- [ ] **Step 3: Split low-level input actions into “paste only” and “paste + send”**

```ts
// src/core/rpa/input-utils.ts
async function focusAndPasteByCoordsAction(x: number, y: number, text: string): Promise<boolean> {
  const robot = getRobot()
  if (!robot) return false

  await humanLikeMove(x, y)
  await randomDelayIn(100, 200)
  robot.mouseClick('left')
  await randomDelayIn(200, 300)
  clipboard.writeText(text)
  await randomDelayIn(50, 100)

  if (IS_MAC) {
    robot.keyTap('v', ['command'])
  } else {
    robot.keyTap('v', ['control'])
  }

  await randomDelayIn(300, 500)
  return true
}

export async function fillDraftByCoordsAction(x: number, y: number, text: string): Promise<boolean> {
  return focusAndPasteByCoordsAction(x, y, text)
}

export async function sendReplyByCoordsAction(x: number, y: number, text: string): Promise<boolean> {
  const pasted = await focusAndPasteByCoordsAction(x, y, text)
  if (!pasted) return false
  const robot = getRobot()
  if (!robot) return false
  robot.keyTap('enter')
  // keep existing platform-specific cleanup
  return true
}
```

- [ ] **Step 4: Wire the new device method through all device implementations**

```ts
// src/core/rpa-device.ts
import { fillDraftAction, sendReplyAction } from './rpa/input-utils'

async fillDraft(text: string): Promise<void> {
  const success = await fillDraftAction(this.appType, text)
  if (!success) throw new Error('写入草稿失败')
}

async sendMessage(text: string): Promise<void> {
  const success = await sendReplyAction(this.appType, text)
  if (!success) throw new Error('发送消息失败')
}
```

```ts
// src/core/box-select-device.ts
import { fillDraftByCoordsAction, sendReplyByCoordsAction } from './rpa/input-utils'

async fillDraft(text: string): Promise<void> {
  const inputArea = getInputAreaFromCache(this.appType)
  if (!inputArea) throw new Error('尚未测量输入框区域')
  const [x, y] = inputArea.coordinates
  const ok = await fillDraftByCoordsAction(x, y, text)
  if (!ok) throw new Error('写入草稿失败')
}
```

```ts
// src/core/mock-device.ts
async fillDraft(text: string): Promise<void> {
  console.log(`[MockDevice] Drafted: ${text}`)
}
```

- [ ] **Step 5: Run test to verify interface and action wiring compile**

Run: `npm run test:session`

Expected: FAIL, but now the failure should be the session behavior still calling `sendMessage` instead of `fillDraft`.

- [ ] **Step 6: Commit the device/config groundwork**

```bash
git add package.json src/main/index.ts src/core/device.ts src/core/rpa/input-utils.ts src/core/rpa-device.ts src/core/box-select-device.ts src/core/mock-device.ts src/renderer/src/App.tsx
git commit -m "新增安全起草模式配置与设备动作"
```

### Task 3: Branch session behavior by reply mode and add draft log events

**Files:**
- Modify: `src/core/session-types.ts`
- Modify: `src/core/generic-channel-session.ts`
- Modify: `src/core/runtime-host.ts` (if helper typings need expansion)
- Modify: `src/main/index.ts:129-131,485-501`
- Modify: `scripts/test-generic-channel-session.ts`
- Test: `scripts/test-generic-channel-session.ts`

- [ ] **Step 1: Add reply mode and a `draft` log/event type to the session model**

```ts
// src/core/session-types.ts
export type ReplyMode = 'draft' | 'auto-send'

export type SessionEvent =
  | { type: 'bootstrap' }
  | { type: 'observe_chat' }
  | { type: 'provider.thinking'; content: string }
  | { type: 'provider.reply_text'; content: string }
  | { type: 'provider.skip' }
  | { type: 'provider.error'; error: string }
  | { type: 'check_unread' }
  | { type: 'wait_retry'; reason?: string; delayMs?: number }

export interface ChannelContext<TState> {
  appType: AppType
  replyMode: ReplyMode
  state: TState
  host: RuntimeHostControls
}

export interface RuntimeHostControls {
  enqueue(event: SessionEvent): void
  schedule(event: SessionEvent, delayMs: number): void
  runProvider(input: ProviderInput): AsyncIterable<ProviderEvent>
  log(type: 'thinking' | 'reply' | 'draft' | 'skip' | 'error', content: string): void
  isRunning(): boolean
  stopSession(reason?: string): Promise<void>
}
```

- [ ] **Step 2: Feed `replyMode` into `RuntimeHost` and `GenericChannelSession`**

```ts
// src/core/runtime-host.ts
interface RuntimeHostOptions<TState> {
  appType: AppType
  replyMode: ReplyMode
  channel: ChannelSession<TState>
  provider: ProviderAdapter
  initialState: TState
  onLog?: (type: 'thinking' | 'reply' | 'draft' | 'skip' | 'error', content: string) => void
}

this.context = {
  appType: options.appType,
  replyMode: options.replyMode,
  state: options.initialState,
  host: this.createControls()
}
```

```ts
// src/main/index.ts inside engine start/update paths
runtime = new RuntimeHost({
  appType: settings.appType,
  replyMode: settings.replyMode,
  channel: new GenericChannelSession(runtimeDevice),
  provider,
  initialState: createInitialGenericChannelState(),
  onLog: (type, content) => { /* existing event bridge */ }
})
```

- [ ] **Step 3: Branch `provider.reply_text` handling on `replyMode`**

```ts
// src/core/generic-channel-session.ts
case 'provider.reply_text': {
  if (ctx.replyMode === 'draft') {
    await this.device.fillDraft(event.content)
    ctx.host.log('draft', event.content)
  } else {
    await this.device.sendMessage(event.content)
    ctx.host.log('reply', event.content)
  }

  await this.device.setChatBaseline()
  ctx.state.latestChatBaseline = Date.now()
  ctx.host.enqueue({ type: 'check_unread' })
  break
}
```

- [ ] **Step 4: Expand the harness to verify both draft and auto-send paths**

```ts
async function runAutoSendScenario() {
  const device = new FakeDevice()
  const session = new GenericChannelSession(device)
  const ctx = createContext('auto-send')

  await session.onEvent({ type: 'provider.reply_text', content: 'final text' }, ctx)

  assert.deepEqual(device.actions, ['sendMessage:final text', 'setChatBaseline'])
}

await runDraftScenario()
await runAutoSendScenario()
console.log('generic-channel-session behavior checks passed')
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:session`

Expected: PASS with `generic-channel-session behavior checks passed`

- [ ] **Step 6: Commit the green session behavior**

```bash
git add src/core/session-types.ts src/core/generic-channel-session.ts src/core/runtime-host.ts src/main/index.ts scripts/test-generic-channel-session.ts
git commit -m "实现安全起草模式会话分流"
```

### Task 4: Expose reply mode in the renderer and update copy

**Files:**
- Modify: `src/renderer/src/App.tsx:6-10,123-136,264-381,523-583`
- Modify: `src/renderer/src/i18n.ts:16-31,76-90`
- Modify: `src/preload/index.ts` (only if renderer typing needs a narrow helper)
- Modify: `src/preload/index.d.ts` (only if helper types change)
- Test: `npm run typecheck`

- [ ] **Step 1: Add the new log type and reply mode UI state**

```ts
// src/renderer/src/App.tsx
interface LogEntry {
  time: string
  type: 'thinking' | 'reply' | 'draft' | 'skip' | 'error'
  content: string
}

type ReplyMode = 'draft' | 'auto-send'
```

- [ ] **Step 2: Add a mode switch to the main control card**

```tsx
function ReplyModeCard({
  replyMode,
  running,
  onChange
}: {
  replyMode: ReplyMode
  running: boolean
  onChange: (mode: ReplyMode) => void
}) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-title">运行模式</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={`btn ${replyMode === 'draft' ? 'btn-primary' : 'btn-secondary'}`} disabled={running} onClick={() => onChange('draft')}>
          安全起草
        </button>
        <button className={`btn ${replyMode === 'auto-send' ? 'btn-primary' : 'btn-secondary'}`} disabled={running} onClick={() => onChange('auto-send')}>
          自动发送
        </button>
      </div>
      <div className="form-hint">
        {replyMode === 'draft' ? 'AI 只填入输入框，不会自动回车发送。' : 'AI 会自动发送生成的回复。'}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Persist the mode through existing settings and engine update flows**

```ts
const [replyMode, setReplyMode] = useState<ReplyMode>('draft')

useEffect(() => {
  void (async () => {
    const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings | undefined
    setReplyMode(settings?.replyMode || 'draft')
  })()
}, [])

const handleReplyModeChange = useCallback(async (next: ReplyMode) => {
  if (status === 'running') return
  setReplyMode(next)
  await window.electron?.invoke('settings:set', { replyMode: next })
  await window.electron?.invoke('engine:updateConfig', {
    ...((await window.electron?.invoke('settings:getAll')) as AppSettings),
    replyMode: next
  })
}, [status])
```

- [ ] **Step 4: Update translation keys for the new draft log and mode copy**

```ts
// src/renderer/src/i18n.ts
'control.log.draft': '起草',
'control.replyMode': '运行模式',
'control.replyMode.draft': '安全起草',
'control.replyMode.autoSend': '自动发送',
'control.replyMode.draftHint': 'AI 只填入输入框，不会自动回车发送。',
'control.replyMode.autoSendHint': 'AI 会自动发送生成的回复。'
```

- [ ] **Step 5: Run typecheck to verify renderer wiring**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 6: Commit the UI wiring**

```bash
git add src/renderer/src/App.tsx src/renderer/src/i18n.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "新增安全起草模式界面开关"
```

### Task 5: Run full verification and note any follow-up risk

**Files:**
- Verify only: no new source files expected

- [ ] **Step 1: Run the session behavior harness**

Run: `npm run test:session`

Expected: PASS with `generic-channel-session behavior checks passed`

- [ ] **Step 2: Run static verification**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 3: Run production build verification**

Run: `npm run build`

Expected: PASS; a Vite chunk warning about `vision-utils.ts` is acceptable if it matches the current baseline and the build exits 0.

- [ ] **Step 4: Inspect final diff**

Run: `git status --short && git diff --stat`

Expected: only the planned source files plus the pre-existing `package.json` / `package-lock.json` dependency fix if it remains intentionally part of the branch.

- [ ] **Step 5: Commit verification-ready implementation**

```bash
git add package.json package-lock.json src/main/index.ts src/core/device.ts src/core/rpa/input-utils.ts src/core/rpa-device.ts src/core/box-select-device.ts src/core/mock-device.ts src/core/session-types.ts src/core/generic-channel-session.ts src/core/runtime-host.ts src/renderer/src/App.tsx src/renderer/src/i18n.ts scripts/test-generic-channel-session.ts
git commit -m "实现安全起草模式"
```

## Spec coverage self-check

- `replyMode` 默认值与配置持久化：Task 2
- Provider 协议保持不变：Task 2 / Task 3
- `fillDraft` 与 `sendMessage` 语义拆分：Task 2
- session 按模式分流：Task 3
- 日志区分起草和发送：Task 3 / Task 4
- 首页模式切换：Task 4
- draft 模式继续巡检并依赖 baseline 防重复起草：Task 3
- 最小行为测试与构建验证：Task 1 / Task 3 / Task 5

## Placeholder scan

- No `TODO`, `TBD`, or “similar to previous task” placeholders remain.
- All code-changing tasks include concrete snippets and exact commands.

## Type consistency check

- `ReplyMode` is consistently `draft | auto-send`.
- Device split uses `fillDraft(text)` and `sendMessage(text)` everywhere.
- Log types are consistently `thinking | reply | draft | skip | error`.
