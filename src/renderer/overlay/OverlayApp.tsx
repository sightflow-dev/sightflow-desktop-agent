import { useEffect, useMemo, useRef, useState } from 'react'

// 框选向导步骤。原本还有 'unreadIndicator'（红点定位），但实际使用里这一步
// 价值很低（许多 IM 用蓝点 / 数字徽标，框红点不准）且容易让用户困惑，已下线。
// BoxSelectDevice 现在统一走 contactList 整体红点扫描 + chatMain pixel diff 兜底。
type WizardStepKey = 'contactList' | 'chatMain' | 'inputBox'

interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

interface BoxRegions {
  contactList: ScreenRect
  chatMain: ScreenRect
  inputBox: ScreenRect
  // 保留字段以与后端类型兼容；wizard 不再采集，统一传 null。
  unreadIndicator: ScreenRect | null
  displayId?: number
  scaleFactor?: number
  capturedAt: number
}

interface InitPayload {
  id: string
  appType: string
  steps: WizardStepKey[]
  prefill: Partial<BoxRegions> | null
  display: {
    id: number
    bounds: { x: number; y: number; width: number; height: number }
    scaleFactor: number
  }
  // 关键：window client area 在屏幕上的绝对位置。
  // 把 event.clientX/Y 加上这个偏移得到屏幕绝对坐标。
  // mac 上菜单栏会把 client area 往下挤，所以这个值通常 != display.bounds。
  contentOriginAbs: { x: number; y: number }
}

const STEP_TITLE: Record<WizardStepKey, string> = {
  contactList: '联系人 / 会话列表',
  chatMain: '会话主区域',
  inputBox: '消息输入框'
}

const STEP_HINT: Record<WizardStepKey, string> = {
  contactList: '框选左侧的会话列表区域。',
  chatMain: '框选当前对话窗口的消息显示区。',
  inputBox: '框选输入框，越精确越好。'
}

const MIN_DRAG_PX = 6

interface PointerState {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
}

function rectFromPointer(p: PointerState): ScreenRect {
  const left = Math.min(p.startX, p.currentX)
  const top = Math.min(p.startY, p.currentY)
  const width = Math.abs(p.currentX - p.startX)
  const height = Math.abs(p.currentY - p.startY)
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width),
    height: Math.round(height)
  }
}

declare global {
  interface Window {
    electron?: {
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void
      send: (channel: string, ...args: unknown[]) => void
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    }
  }
}

// Mini schematic of the IM window layout, sitting in the wizard header.
// Three small cells (left contact list, top-right chat area, bottom-right
// input bar) shaped like a typical IM window. The cell that maps to the
// current step pulses; previously-committed steps stay solid; not-yet-reached
// steps are dim. Lets the user know "next I'm framing the input bar" before
// they even start dragging — and the schematic stays in the header so it
// never covers the actual app the user wants to frame.
function LayoutPreview({
  steps,
  stepIdx
}: {
  steps: WizardStepKey[]
  stepIdx: number
}): React.JSX.Element {
  const stateOf = (key: WizardStepKey): 'pending' | 'active' | 'done' => {
    const idx = steps.indexOf(key)
    if (idx < 0 || idx > stepIdx) return 'pending'
    if (idx === stepIdx) return 'active'
    return 'done'
  }
  const cell = (key: WizardStepKey, modifier: string): React.JSX.Element => (
    <div className={`overlay__layout-cell overlay__layout-cell--${modifier} is-${stateOf(key)}`} />
  )
  return (
    <div className="overlay__layout-preview" aria-hidden>
      {cell('contactList', 'list')}
      {cell('chatMain', 'chat')}
      {cell('inputBox', 'input')}
    </div>
  )
}

export function OverlayApp(): React.ReactElement {
  const [init, setInit] = useState<InitPayload | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [pointer, setPointer] = useState<PointerState | null>(null)
  const [committed, setCommitted] = useState<Partial<Record<WizardStepKey, ScreenRect>>>({})
  const cancelArmedRef = useRef(false)

  useEffect(() => {
    const cleanup = window.electron?.on('overlay-wizard:init', (payload) => {
      setInit(payload as InitPayload)
      setStepIdx(0)
      setCommitted({})
    })
    return cleanup
  }, [])

  const steps = init?.steps ?? []
  const currentStep = steps[stepIdx]
  const total = steps.length

  // Cancellation: first Esc cancels current draft if drawing; otherwise cancels the whole wizard.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || !init) return
      if (pointer) {
        setPointer(null)
        cancelArmedRef.current = false
        return
      }
      if (cancelArmedRef.current) {
        window.electron?.send('overlay-wizard:cancel', { id: init.id })
      } else {
        cancelArmedRef.current = true
        window.setTimeout(() => {
          cancelArmedRef.current = false
        }, 1500)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [init, pointer])

  function toAbsolute(rect: ScreenRect): ScreenRect {
    if (!init) return rect
    // 用 contentOriginAbs（client area 真实左上角）而不是 display.bounds：
    // mac frameless window 的 client 区域被菜单栏推下后，二者会差 24-37px，
    // 用 display.bounds 会让纵向坐标整体偏小，点击落在输入框上边缘。
    return {
      x: rect.x + init.contentOriginAbs.x,
      y: rect.y + init.contentOriginAbs.y,
      width: rect.width,
      height: rect.height
    }
  }

  function commitStep(key: WizardStepKey, rect: ScreenRect | null): void {
    setCommitted((prev) => ({ ...prev, [key]: rect ?? undefined }))
  }

  function advanceOrFinish(
    nextIdx: number,
    draft: Partial<Record<WizardStepKey, ScreenRect>>
  ): void {
    if (!init) return
    if (nextIdx < total) {
      setStepIdx(nextIdx)
      return
    }
    const regions: BoxRegions = {
      contactList: toAbsolute(draft.contactList!),
      chatMain: toAbsolute(draft.chatMain!),
      inputBox: toAbsolute(draft.inputBox!),
      // unreadIndicator 已从向导移除；BoxSelectDevice 用 contactList 整体扫红点
      // + chatMain pixel diff 兜底，无需用户单独框出。
      unreadIndicator: null,
      displayId: init.display.id,
      scaleFactor: init.display.scaleFactor,
      capturedAt: Date.now()
    }
    window.electron?.send('overlay-wizard:complete', { id: init.id, regions })
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (!currentStep) return
    if (e.button !== 0) return
    // 关键：来自 header（步骤说明 + 按钮组）或 footer 的 pointer event 必须放行。
    // 否则 e.preventDefault() 会取消同序列的合成 click，导致 "上一步 / 取消"
    // 等按钮点不动。
    const target = e.target as HTMLElement | null
    if (target && (target.closest('.overlay__header') || target.closest('.overlay__footer'))) {
      return
    }
    const x = e.clientX
    const y = e.clientY
    setPointer({ pointerId: e.pointerId, startX: x, startY: y, currentX: x, currentY: y })
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!pointer || pointer.pointerId !== e.pointerId) return
    setPointer({ ...pointer, currentX: e.clientX, currentY: e.clientY })
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (!pointer || pointer.pointerId !== e.pointerId) return
    const final = rectFromPointer(pointer)
    setPointer(null)
    if (!currentStep) return
    if (final.width < MIN_DRAG_PX || final.height < MIN_DRAG_PX) {
      // too small → treat as cancel of this step only
      return
    }
    const next = { ...committed, [currentStep]: final }
    commitStep(currentStep, final)
    advanceOrFinish(stepIdx + 1, next)
  }

  function onAbort(): void {
    if (!init) return
    window.electron?.send('overlay-wizard:cancel', { id: init.id })
  }

  function onBack(): void {
    if (stepIdx === 0 || !currentStep) return
    const previousStepKey = steps[stepIdx - 1]
    setCommitted((prev) => {
      const next = { ...prev }
      delete next[previousStepKey]
      return next
    })
    setStepIdx(stepIdx - 1)
  }

  const liveRect = useMemo(() => (pointer ? rectFromPointer(pointer) : null), [pointer])

  if (!init || !currentStep) {
    return (
      <div className="overlay">
        <div className="overlay__header">
          <span className="overlay__hint">正在加载框选向导...</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className="overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="overlay__header">
        <LayoutPreview steps={steps} stepIdx={stepIdx} />
        <span className="overlay__step">
          步骤 {stepIdx + 1} / {total}
        </span>
        <span className="overlay__hint">
          <strong>{STEP_TITLE[currentStep]}</strong>
          {' — '}
          {STEP_HINT[currentStep]}
        </span>
        <div className="overlay__actions">
          {stepIdx > 0 && (
            <button className="overlay__btn" onClick={onBack}>
              上一步
            </button>
          )}
          <button className="overlay__btn" onClick={onAbort}>
            取消
          </button>
        </div>
      </div>

      {/* committed rects from previous steps + a crosshair on each rect's
       * geometric center, so users can see exactly where the engine will
       * click. inputBox gets a louder red crosshair because that's the
       * paste-and-Enter target and the most sensitive to misalignment. */}
      {(Object.keys(committed) as WizardStepKey[]).map((key) => {
        const rect = committed[key]
        if (!rect) return null
        const cx = rect.x + rect.width / 2
        const cy = rect.y + rect.height / 2
        const isInput = key === 'inputBox'
        return (
          <div key={key}>
            <div
              className="overlay__committed"
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            >
              <span className="overlay__committed-label">{STEP_TITLE[key]}</span>
            </div>
            <svg
              className={
                isInput ? 'overlay__crosshair overlay__crosshair--input' : 'overlay__crosshair'
              }
              style={{ left: cx, top: cy }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={isInput ? 2.5 : 2}
              strokeLinecap="round"
            >
              <line x1="12" y1="3" x2="12" y2="21" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <circle cx="12" cy="12" r={isInput ? 3.5 : 2.5} fill="currentColor" />
            </svg>
          </div>
        )
      })}

      {/* live drag rect */}
      {liveRect && (
        <div
          className="overlay__rect"
          style={{
            left: liveRect.x,
            top: liveRect.y,
            width: liveRect.width,
            height: liveRect.height
          }}
        />
      )}

      <div className="overlay__footer">
        提示：拖动鼠标框出区域；松开提交，按 Esc 取消，连按两次 Esc 退出向导。
      </div>
    </div>
  )
}
