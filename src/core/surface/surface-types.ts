// src/core/surface/surface-types.ts
// 统一操作面契约（Phase 2 地基）—— desktop / browser / api 都实现同一套 Surface。
//
// Phase 1 定义了「语义动作空间」(action-types)，Phase 2 定义「谁来执行 + 怎么观察」：
// 一个 Surface 能 observe()(把当前环境结构化成可决策的 Observation) 和 act(Action)
// (执行一个语义动作并回报结果)。记忆系统据此跨操作面统一记录与复用——
// 同一条「点发送按钮」的经验，desktop 面靠 VLM 接地、browser 面靠 DOM 接地，
// 但在动作空间和 work-trace 里长一个样。

import type { Action, GroundingSource } from '../action/action-types'

export type SurfaceKind = 'desktop' | 'browser'

/**
 * 操作面上的一个可交互/可观察元素（browser-use 式编号元素）。
 * index 在单次 observe() 内稳定，供「按编号点击」与语义复用。
 */
export interface SurfaceElement {
  index: number
  /** 语义角色：button / textbox / link / checkbox / … */
  role: string
  /** 可访问名 / 可见文本 */
  name: string
  value?: string
  /** 元素在视口内的包围盒（px），可选 */
  bbox?: [number, number, number, number]
  /** 执行用选择器（css / xpath / aria），由具体 driver 提供 */
  selector?: string
  attributes?: Record<string, string>
  /** 是否可交互（可点 / 可输入），不可交互的纯文本不参与动作目标解析 */
  interactive: boolean
}

/** 一次观察的结构化结果：决策层据此规划下一个 Action */
export interface SurfaceObservation {
  kind: SurfaceKind
  url?: string
  title?: string
  screenshotBase64?: string
  elements: SurfaceElement[]
  /** 给 LLM 读的紧凑序列化（编号元素清单） */
  elementsText: string
  ts: number
}

/** 一个动作执行后的结果，channel 据此落 work-trace（semanticTarget / bbox / groundingSource） */
export interface ActionResult {
  ok: boolean
  error?: string
  groundingSource?: GroundingSource
  /** 解析到的目标（再接地结果），写回轨迹用 */
  resolved?: {
    semanticTarget?: string
    index?: number
    bbox?: [number, number, number, number]
  }
}

/** 统一操作面接口：desktop / browser / (未来) api 都实现它 */
export interface Surface {
  readonly kind: SurfaceKind
  observe(options?: { screenshot?: boolean }): Promise<SurfaceObservation>
  act(action: Action): Promise<ActionResult>
  /** 浏览器：导航；桌面：切换/打开应用。可选。 */
  open?(target: string): Promise<void>
  close?(): Promise<void>
}
