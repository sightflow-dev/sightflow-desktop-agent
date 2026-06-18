// src/core/browser/browser-surface.ts
// BrowserSurface —— 在 BrowserDriver 之上实现统一 Surface 接口。
//
// 把 Phase 1 的语义 Action 翻译成浏览器操作：click/type/scroll/open_url …
// 动作目标用 DOM 元素清单「再接地」(resolveTarget)，groundingSource='dom'。
// driver 注入，因此本类的「脑」可用 fake driver 完整单测（无需真实浏览器）。

import type { Action } from '../action/action-types'
import type {
  ActionResult,
  Surface,
  SurfaceElement,
  SurfaceObservation
} from '../surface/surface-types'
import type { BrowserDriver } from './browser-driver'
import { indexElements, resolveTarget, serializeElements } from './dom-elements'

export class BrowserSurface implements Surface {
  readonly kind = 'browser' as const
  /** 最近一次 observe 的元素清单，供 act() 再接地引用 */
  private lastElements: SurfaceElement[] = []

  constructor(private readonly driver: BrowserDriver) {}

  async observe(options?: { screenshot?: boolean }): Promise<SurfaceObservation> {
    const snap = await this.driver.snapshot({ screenshot: options?.screenshot ?? false })
    const elements = indexElements(snap.elements)
    this.lastElements = elements
    return {
      kind: 'browser',
      url: snap.url,
      title: snap.title,
      screenshotBase64: snap.screenshotBase64,
      elements,
      elementsText: serializeElements(elements),
      ts: Date.now()
    }
  }

  async open(target: string): Promise<void> {
    await this.driver.goto(target)
  }

  async act(action: Action): Promise<ActionResult> {
    try {
      switch (action.kind) {
        case 'open_url': {
          if (!action.payload) return fail('open_url 缺少 url')
          await this.driver.goto(action.payload)
          return { ok: true, groundingSource: 'fixed' }
        }
        case 'key': {
          if (!action.payload) return fail('key 缺少按键名')
          await this.driver.pressKey(action.payload)
          return { ok: true, groundingSource: 'fixed' }
        }
        case 'scroll': {
          // payload 形如 "0,600"；缺省向下滚一屏
          const [dx, dy] = parseScroll(action.payload)
          await this.driver.scroll(dx, dy)
          return { ok: true, groundingSource: 'fixed' }
        }
        case 'click':
        case 'double_click':
        case 'right_click': {
          const el = await this.reground(action)
          if (!el?.selector) return fail(`未能在页面上定位目标：${describe(action)}`)
          await this.driver.clickSelector(el.selector)
          return resolvedResult(el)
        }
        case 'type':
        case 'paste':
        case 'send': {
          const el = await this.reground(action)
          if (!el?.selector) return fail(`未能在页面上定位输入目标：${describe(action)}`)
          await this.driver.fillSelector(el.selector, action.payload ?? '')
          if (action.kind === 'send') await this.driver.pressKey('Enter')
          return resolvedResult(el)
        }
        case 'observe':
        case 'measure':
        case 'wait':
          return { ok: true }
        default:
          return fail(`browser surface 不支持的动作：${action.kind}`)
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }

  async close(): Promise<void> {
    await this.driver.close()
  }

  /** 动作目标再接地：先用缓存清单，空则取一次快照再 resolve */
  private async reground(action: Action): Promise<SurfaceElement | null> {
    if (this.lastElements.length === 0) {
      await this.observe()
    }
    return resolveTarget(this.lastElements, action.target)
  }
}

function resolvedResult(el: SurfaceElement): ActionResult {
  return {
    ok: true,
    groundingSource: 'dom',
    resolved: { semanticTarget: el.name || undefined, index: el.index, bbox: el.bbox }
  }
}

function fail(error: string): ActionResult {
  return { ok: false, error }
}

function describe(action: Action): string {
  return action.target?.semanticTarget ?? action.kind
}

function parseScroll(payload?: string): [number, number] {
  if (!payload) return [0, 600]
  const parts = payload.split(',').map((p) => Number(p.trim()))
  const dx = Number.isFinite(parts[0]) ? parts[0] : 0
  const dy = Number.isFinite(parts[1]) ? parts[1] : 600
  return [dx, dy]
}
