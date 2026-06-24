// src/core/trace/trace-types.ts
// Work-trace 数据模型 — 「学」能力的地基
//
// 每次引擎执行的每个有意义步骤都落成一条 TraceStep（五元组：时间戳 / 界面状态 /
// 判断依据 / 动作 / 结果），按 session 聚合，append-only 持久化到本地。
// schema 字段与 docs/plan/learn-work-memory-plan.md 第三节一一对应。

import { AppType } from '../rpa/types'

export type TraceActor = 'agent' | 'human'
export type TracePhase = 'observe' | 'think' | 'act' | 'verify'
export type TraceOutcomeStatus = 'ok' | 'fail' | 'skip'
// 通用电脑操作动作词表：从 IM 专用（click/send/measure/wait）泛化到任意桌面/浏览器，
// 让同一套 work-trace 既能记微信回复，也能记网页操作（navigate）、应用切换（switch_app）。
export type TraceActionKind =
  | 'click'
  | 'type'
  | 'scroll'
  | 'key'
  | 'drag'
  | 'navigate'
  | 'switch_app'
  | 'send'
  | 'measure'
  | 'wait'

/** 目标元素的可访问性身份 —— 跨应用录制/回放的锚点（浏览器走 selector，桌面走 a11y role/name）。 */
export interface TraceElement {
  /** a11y role（button / textbox …）或 DOM tag */
  role?: string
  /** 可访问名称 / label / 文本 */
  name?: string
  /** 元素当前值 */
  value?: string
  /** 浏览器 CSS/XPath，或桌面控件路径 */
  selector?: string
}

/** 当时的活动窗口 / 应用上下文 —— 让一条轨迹能跨应用归属（哪个 App、哪个窗口、桌面还是浏览器）。 */
export interface TraceWindow {
  /** bundle id / 进程名 */
  appId?: string
  /** 窗口标题 */
  title?: string
  /** 操作面：桌面原生应用 or 浏览器页面 */
  surface?: 'desktop' | 'browser'
}

export interface TraceSessionMeta {
  sessionId: string
  appType: AppType
  startedAt: number
  endedAt?: number
  engineVersion: string
  providerId?: string
  model?: string
  stepCount: number
}

export interface TraceReasoning {
  content: string
  /** 本步引用了哪些经验卡片（cardId），用于继承闭环度量 */
  memoryRefs?: string[]
}

export interface TraceAction {
  kind: TraceActionKind
  /** 屏幕坐标（click 类动作） */
  target?: [number, number]
  /** 动作负载（send / type 的文本等） */
  payload?: string
  /** 目标元素的可访问性身份（跨应用录制/回放用） */
  element?: TraceElement
  /** navigate 动作的目标 URL */
  url?: string
}

export interface TraceOutcome {
  status: TraceOutcomeStatus
  detail?: string
  latencyMs?: number
}

export interface TraceStep {
  stepId: string
  sessionId: string
  seq: number
  ts: number
  actor: TraceActor
  phase: TracePhase
  /** 一句话概述，时间轴 UI 直接展示 */
  summary: string
  /** 当时的活动窗口/应用上下文（跨应用轨迹的关键字段） */
  window?: TraceWindow
  screen?: { screenshotPath: string }
  reasoning?: TraceReasoning
  action?: TraceAction
  outcome?: TraceOutcome
}

/**
 * 业务层（session / host）提交轨迹时的输入。
 * stepId / sessionId / seq / ts 由 TraceRecorder 填充；
 * 截图以 base64 传入，由 recorder 落盘并替换为相对路径。
 */
export interface TraceStepInput {
  actor?: TraceActor
  phase: TracePhase
  summary: string
  /** 当时的活动窗口/应用上下文（可选；桌面侧由 active-win 提供，浏览器侧由页面提供） */
  window?: TraceWindow
  screenshotBase64?: string
  reasoning?: TraceReasoning
  action?: TraceAction
  outcome?: TraceOutcome
}

/** 注入给 Provider 的经验卡片摘要（完整卡片定义见 memory/experience-store.ts） */
export interface MemoryCardBrief {
  cardId: string
  scenario: string
  guidance: string
  rationale?: string
}
