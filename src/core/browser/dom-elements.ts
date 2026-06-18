// src/core/browser/dom-elements.ts
// 浏览器操作面的「脑」—— 把一页 DOM 变成可决策、可记忆复用的编号元素清单。
// 纯函数、无 Playwright 依赖，可独立单测。这是 browser-use 范式在 TS 里的核心 IP：
//   抓取 → 编号(index) → 序列化给 LLM → 按语义/编号再接地(resolve)。
//
// 为什么是 IP：DOM 接地比像素点击稳得多，且产出的是「点[3]发送按钮」这种语义动作，
// 天然可继承（Phase 1 的 semanticTarget）。复用记忆时对语义目标在新页面上重新 resolve，
// 而不是回放坐标。

import type { RawDomElement } from './browser-driver'
import type { SurfaceElement } from '../surface/surface-types'
import type { ActionTarget } from '../action/action-types'

/** 可交互角色集合（其余视为纯展示元素，不参与动作目标解析） */
const INTERACTIVE_ROLES = new Set([
  'a',
  'button',
  'link',
  'input',
  'textbox',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'combobox',
  'menuitem',
  'tab',
  'switch'
])

export function isInteractiveRole(role: string): boolean {
  return INTERACTIVE_ROLES.has(role.toLowerCase())
}

/**
 * 给原始元素编号 → SurfaceElement[]。
 * index 在本次快照内稳定（0..n），供「按编号点击」与序列化引用。
 */
export function indexElements(raw: RawDomElement[]): SurfaceElement[] {
  return raw.map((el, i) => ({
    index: i,
    role: el.role,
    name: el.name,
    value: el.value,
    bbox: el.bbox,
    selector: el.selector,
    attributes: el.attributes,
    interactive: isInteractiveRole(el.role)
  }))
}

/**
 * 序列化成 LLM 可读清单（只列可交互元素，控 token）：
 *   [3]<button>发送</button>
 *   [4]<input placeholder="搜索">…</input>
 */
export function serializeElements(elements: SurfaceElement[]): string {
  return elements
    .filter((el) => el.interactive)
    .map((el) => {
      const label = el.name || el.value || ''
      return `[${el.index}]<${el.role}>${label}</${el.role}>`
    })
    .join('\n')
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}

/**
 * 按动作目标在元素清单里「再接地」。匹配优先级：
 *   1. semanticTarget 里显式编号 "[3]" / "3" → 直接取 index
 *   2. name/value 完全相等（归一化大小写空白）
 *   3. name 包含 semanticTarget 或反之（模糊）
 * 找不到返回 null（调用方据此报失败 / 转人工，而不是乱点）。
 */
export function resolveTarget(
  elements: SurfaceElement[],
  target: ActionTarget | undefined
): SurfaceElement | null {
  if (!target) return null
  const interactive = elements.filter((el) => el.interactive)

  // 1. 显式编号
  if (target.semanticTarget) {
    const m = target.semanticTarget.match(/\[?(\d+)\]?/)
    if (m && /^\[?\d+\]?$/.test(target.semanticTarget.trim())) {
      const idx = Number(m[1])
      const byIndex = interactive.find((el) => el.index === idx)
      if (byIndex) return byIndex
    }
  }

  const q = target.semanticTarget ? norm(target.semanticTarget) : ''
  if (q) {
    // 2. 完全相等
    const exact = interactive.find((el) => norm(el.name) === q || norm(el.value ?? '') === q)
    if (exact) return exact
    // 3. 模糊包含
    const fuzzy = interactive.find((el) => {
      const n = norm(el.name)
      return n.length > 0 && (n.includes(q) || q.includes(n))
    })
    if (fuzzy) return fuzzy
  }

  // 4. 兜底：bbox 中心最接近（如果 target 带 bbox）
  if (target.bbox) {
    const [tx, ty] = bboxCenter(target.bbox)
    let best: SurfaceElement | null = null
    let bestDist = Infinity
    for (const el of interactive) {
      if (!el.bbox) continue
      const [ex, ey] = bboxCenter(el.bbox)
      const d = (ex - tx) ** 2 + (ey - ty) ** 2
      if (d < bestDist) {
        bestDist = d
        best = el
      }
    }
    if (best) return best
  }

  return null
}

function bboxCenter(b: [number, number, number, number]): [number, number] {
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
}
