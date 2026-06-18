// src/core/trace/trace-types.ts
// Work-trace 数据模型 — 「学」能力的地基
//
// 每次引擎执行的每个有意义步骤都落成一条 TraceStep（五元组：时间戳 / 界面状态 /
// 判断依据 / 动作 / 结果），按 session 聚合，append-only 持久化到本地。
// schema 字段与 docs/plan/learn-work-memory-plan.md 第三节一一对应。
//
// schema v1.0：在 v0 基础上新增 schemaVersion / taskId / episodeId / verification /
// intervention，全部为可选字段，向后兼容历史 trace.jsonl（旧行缺字段照常解析，
// 读取时由 normalizeTraceStep 补 schemaVersion='0'）。详见 trace-recorder.ts。

import type { AppType } from '../rpa/types'
import type { ActionKind, GroundingSource, Surface } from '../action/action-types'

/** 当前 trace schema 版本。历史（无该字段）的步骤读取时标记为 '0'。 */
export const CURRENT_TRACE_SCHEMA_VERSION = '1.0'

export type TraceActor = 'agent' | 'human' | 'system'

/**
 * 执行闭环的阶段。v0 仅有 observe/think/act/verify；v1 扩展出完整闭环阶段，
 * 旧值全部保留，UI 对未知阶段回退展示，不会破坏历史数据。
 */
export type TracePhase =
  | 'receive'
  | 'observe'
  | 'retrieve_memory'
  | 'think'
  | 'act'
  | 'verify'
  | 'wait'
  | 'recover'
  | 'escalate'
  | 'outcome'

export type TraceOutcomeStatus = 'ok' | 'fail' | 'skip'
/** @deprecated 改用 action-types 的 ActionKind（语义动作空间，本类型是其子集） */
export type TraceActionKind = 'click' | 'send' | 'measure' | 'wait'

export interface TraceSessionMeta {
  sessionId: string
  /** 所属任务 / 片段（v1 预留，跨 session 任务层落地后填充） */
  taskId?: string
  episodeId?: string
  appType: AppType
  startedAt: number
  endedAt?: number
  engineVersion: string
  providerId?: string
  model?: string
  promptVersion?: string
  /** schema 版本，便于离线迁移；历史会话读取时补 '0' */
  schemaVersion?: string
  stepCount: number
}

export interface TraceReasoning {
  content: string
  /** 本步引用了哪些经验卡片（cardId），用于继承闭环度量 */
  memoryRefs?: string[]
}

export interface TraceAction {
  kind: ActionKind
  /** 操作面：动作落在 desktop / browser / api 哪个执行环境 */
  surface?: Surface
  /**
   * 语义目标 —— 可继承的关键字段。记「点搜索框」而不是「点 (412,88)」，
   * 换分辨率 / 换 OS / 换模型仍可复用（复用时对该语义目标重新接地）。
   */
  semanticTarget?: string
  /** 接地中间产物：归一化 0-1000 bbox（跨分辨率可复算） */
  bbox?: [number, number, number, number]
  /** 实际执行的屏幕坐标（最易随环境变化；历史轨迹只有这一层） */
  target?: [number, number]
  /** 这个坐标怎么定位出来的（vlm / box-select / dom / cache …），评测与缓存命中统计用 */
  groundingSource?: GroundingSource
  /** 动作负载（send / type 的文本等） */
  payload?: string
}

export interface TraceOutcome {
  status: TraceOutcomeStatus
  detail?: string
  latencyMs?: number
}

/** 验证记录 — 动作是否真的达到了预期状态（执行闭环 Verify 步） */
export interface VerificationRecord {
  /** 期望达到的状态，一句话 */
  expected: string
  status: 'confirmed' | 'not_confirmed' | 'partial' | 'unknown'
  evidence?: string[]
  confidence?: number
}

/**
 * 人工介入记录 — 一等公民学习信号（doc §2.4 / §13）。
 * 人在某一步上纠正 / 接管，被记成 actor='human' 的 TraceStep 并携带 correction，
 * correction.reusableLesson 是后续归纳经验卡片的种子。
 */
export interface HumanIntervention {
  interventionId: string
  type: 'approve' | 'reject' | 'edit' | 'takeover' | 'annotate' | 'resume'
  reason?: string
  /** 被纠正的原步骤 id */
  beforeStepId?: string
  correction?: {
    wrongDecision?: string
    correctedDecision?: string
    reusableLesson?: string
  }
  /** 由本次纠正生成的经验卡片 id（可空，便于从轨迹回链到记忆） */
  memoryCardId?: string
  humanId?: string
  ts: number
}

export interface TraceStep {
  /** schema 版本；历史步骤读取时补 '0' */
  schemaVersion?: string
  stepId: string
  sessionId: string
  taskId?: string
  episodeId?: string
  seq: number
  ts: number
  actor: TraceActor
  phase: TracePhase
  /** 一句话概述，时间轴 UI 直接展示 */
  summary: string
  screen?: { screenshotPath: string }
  reasoning?: TraceReasoning
  action?: TraceAction
  verification?: VerificationRecord
  intervention?: HumanIntervention
  outcome?: TraceOutcome
}

/**
 * 业务层（session / host）提交轨迹时的输入。
 * stepId / sessionId / seq / ts / schemaVersion 由 TraceRecorder 填充；
 * 截图以 base64 传入，由 recorder 落盘并替换为相对路径。
 */
export interface TraceStepInput {
  actor?: TraceActor
  phase: TracePhase
  summary: string
  taskId?: string
  episodeId?: string
  screenshotBase64?: string
  reasoning?: TraceReasoning
  action?: TraceAction
  verification?: VerificationRecord
  intervention?: HumanIntervention
  outcome?: TraceOutcome
}

/** 注入给 Provider 的经验卡片摘要（完整卡片定义见 memory/experience-store.ts） */
export interface MemoryCardBrief {
  cardId: string
  scenario: string
  guidance: string
  rationale?: string
}

/**
 * 读取历史轨迹时的兼容归一化：
 * - 旧步骤无 schemaVersion → 标记为 '0'，让消费方能区分新旧
 * - 缺 actor 兜底 'agent'
 * 不丢弃任何已有字段，纯附加。
 */
export function normalizeTraceStep(step: TraceStep): TraceStep {
  if (step.schemaVersion && step.actor) return step
  return {
    ...step,
    schemaVersion: step.schemaVersion ?? '0',
    actor: step.actor ?? 'agent'
  }
}
