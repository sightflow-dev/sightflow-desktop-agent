// src/core/memory/experience-store.ts
// 经验卡片存储 — 过程性记忆的最小单元
//
// 卡片来源三种：agent_summary（LLM 从轨迹归纳）、human_takeover（人工纠正）、
// manual（手动录入）。运行时按场景检索 top-k 启用卡片注入 provider（见 memory-retriever.ts），
// 不再全量注入；每次检索 / 应用 / 验证 / 人工推翻都计数，让「这条经验有没有用」可量化。
//
// 生命周期（doc §10）：单条轨迹归纳与人工纠正只产出 pending_review 候选，必须人工
// 批准（approve）后才进入 active、参与检索注入——高风险记忆不自动启用是硬红线。
//
// 存储：单个 JSON 文件（<userData>/worktrace/memory/cards.json），同步读写。
// 文件 version 2：在 v1（{used,success}）基础上扩展字段，load 时迁移旧卡片。

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AppType } from '../rpa/types'

export type ExperienceCardSource = 'agent_summary' | 'human_takeover' | 'manual'

/** 记忆类型（doc §8）：事件 / 流程 / 决策 / 红线约束 */
export type MemoryKind = 'event' | 'procedure' | 'decision' | 'constraint'

/** 生命周期状态：草稿审核中 / 已启用 / 已驳回 / 已废弃 */
export type MemoryStatus = 'pending_review' | 'active' | 'rejected' | 'deprecated'

export type RiskLevel = 'low' | 'medium' | 'high'

/** 作用域硬过滤维度。留空表示「不限制该维度」。 */
export interface MemoryScope {
  appTypes?: AppType[]
  taskTypes?: string[]
  tags?: string[]
}

/** 效果度量：区分「被检索 / 被应用 / 验证成功失败 / 人工推翻」，而非单一 success 布尔 */
export interface ExperienceCardStats {
  /** 被检索注入次数 */
  retrieved: number
  /** 被某一步实际引用（act/send）次数 */
  applied: number
  /** 引用后动作验证成功次数 */
  verifiedSuccess: number
  /** 引用后动作验证失败次数 */
  verifiedFailure: number
  /** 引用后被人工纠正 / 推翻次数 */
  humanOverride: number
}

export interface ExperienceCard {
  cardId: string
  kind: MemoryKind
  status: MemoryStatus
  /** 触发条件：什么情况下适用 */
  scenario: string
  /** 该怎么做 */
  guidance: string
  /** 为什么——老员工的判断依据 */
  rationale: string
  source: ExperienceCardSource
  scope?: MemoryScope
  /** 0..1，单条轨迹归纳 / 人工候选默认 0.5；人工批准后可上调 */
  confidence: number
  riskLevel: RiskLevel
  version: number
  /** 来源轨迹（可审计：每张卡片能回溯到出处） */
  evidence: { sessionId?: string; stepIds?: string[] }
  /** 用户手动开关（仅对 active 卡片生效）；与 status 正交 */
  enabled: boolean
  stats: ExperienceCardStats
  createdAt: number
  updatedAt: number
  lastReviewedAt?: number
}

export interface NewExperienceCard {
  scenario: string
  guidance: string
  rationale?: string
  source: ExperienceCardSource
  kind?: MemoryKind
  scope?: MemoryScope
  confidence?: number
  riskLevel?: RiskLevel
  /** 不传则按来源推断：manual→active，其余→pending_review */
  status?: MemoryStatus
  evidence?: { sessionId?: string; stepIds?: string[] }
}

const STORE_FILE_VERSION = 2

function emptyStats(): ExperienceCardStats {
  return { retrieved: 0, applied: 0, verifiedSuccess: 0, verifiedFailure: 0, humanOverride: 0 }
}

/** 来源决定默认初始状态：手动录入直接生效；归纳 / 纠正进审核队列 */
function defaultStatusForSource(source: ExperienceCardSource): MemoryStatus {
  return source === 'manual' ? 'active' : 'pending_review'
}

/**
 * 把任意（可能是 v1 旧格式）卡片对象迁移成当前 ExperienceCard。
 * 旧 stats {used,success} → applied/verifiedSuccess/retrieved 回填；
 * 旧卡片无 status → 'active'（保持历史「启用即注入」行为），无 kind → 'procedure'。
 * 纯函数、无副作用，便于单测。
 */
export function migrateCard(raw: unknown): ExperienceCard | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.scenario !== 'string' || typeof r.guidance !== 'string') return null

  const rawStats = (r.stats ?? {}) as Record<string, unknown>
  const rawEvidence = (r.evidence ?? {}) as Record<string, unknown>
  const legacyUsed = Number(rawStats.used) || 0
  const legacySuccess = Number(rawStats.success) || 0
  const stats: ExperienceCardStats = {
    retrieved: Number(rawStats.retrieved ?? legacyUsed) || 0,
    applied: Number(rawStats.applied ?? legacyUsed) || 0,
    verifiedSuccess: Number(rawStats.verifiedSuccess ?? legacySuccess) || 0,
    verifiedFailure: Number(rawStats.verifiedFailure) || 0,
    humanOverride: Number(rawStats.humanOverride) || 0
  }

  const source: ExperienceCardSource =
    r.source === 'agent_summary' || r.source === 'human_takeover' || r.source === 'manual'
      ? r.source
      : 'manual'

  const createdAt = Number(r.createdAt) || Date.now()
  return {
    cardId: typeof r.cardId === 'string' ? r.cardId : randomUUID(),
    kind: isMemoryKind(r.kind) ? r.kind : 'procedure',
    status: isMemoryStatus(r.status) ? r.status : 'active',
    scenario: r.scenario.trim(),
    guidance: r.guidance.trim(),
    rationale: typeof r.rationale === 'string' ? r.rationale.trim() : '',
    source,
    scope: normalizeScope(r.scope),
    confidence: clamp01(Number(r.confidence), source === 'manual' ? 0.7 : 0.5),
    riskLevel: isRiskLevel(r.riskLevel) ? r.riskLevel : 'medium',
    version: Number(r.version) || 1,
    evidence: {
      sessionId: typeof rawEvidence.sessionId === 'string' ? rawEvidence.sessionId : undefined,
      stepIds: Array.isArray(rawEvidence.stepIds)
        ? rawEvidence.stepIds.filter((s: unknown): s is string => typeof s === 'string')
        : undefined
    },
    enabled: r.enabled !== false,
    stats,
    createdAt,
    updatedAt: Number(r.updatedAt) || createdAt,
    lastReviewedAt: Number(r.lastReviewedAt) || undefined
  }
}

export class ExperienceStore {
  private cards: ExperienceCard[] | null = null

  constructor(private readonly filePath: string) {}

  listCards(): ExperienceCard[] {
    return [...this.load()].sort((a, b) => b.createdAt - a.createdAt)
  }

  /** 可参与运行时检索注入的卡片：已启用且用户未停用。pending/rejected/deprecated 一律排除。 */
  getRetrievableCards(): ExperienceCard[] {
    return this.load().filter((card) => card.status === 'active' && card.enabled)
  }

  addCards(inputs: NewExperienceCard[]): ExperienceCard[] {
    const cards = this.load()
    const now = Date.now()
    const created = inputs
      .filter((input) => input.scenario?.trim() && input.guidance?.trim())
      .map((input): ExperienceCard => {
        const status = input.status ?? defaultStatusForSource(input.source)
        return {
          cardId: randomUUID(),
          kind: input.kind ?? 'procedure',
          status,
          scenario: input.scenario.trim(),
          guidance: input.guidance.trim(),
          rationale: input.rationale?.trim() || '',
          source: input.source,
          scope: normalizeScope(input.scope),
          confidence: clamp01(input.confidence, input.source === 'manual' ? 0.7 : 0.5),
          riskLevel: input.riskLevel ?? (input.source === 'human_takeover' ? 'medium' : 'low'),
          version: 1,
          evidence: input.evidence ?? {},
          enabled: true,
          stats: emptyStats(),
          createdAt: now,
          updatedAt: now,
          lastReviewedAt: status === 'active' && input.source === 'manual' ? now : undefined
        }
      })
    cards.push(...created)
    this.flush()
    return created
  }

  deleteCard(cardId: string): boolean {
    const cards = this.load()
    const index = cards.findIndex((card) => card.cardId === cardId)
    if (index === -1) return false
    cards.splice(index, 1)
    this.flush()
    return true
  }

  setEnabled(cardId: string, enabled: boolean): boolean {
    const card = this.find(cardId)
    if (!card) return false
    card.enabled = enabled
    card.updatedAt = Date.now()
    this.flush()
    return true
  }

  /** 审核通过：pending_review → active，记录审核时间。 */
  approve(cardId: string): boolean {
    const card = this.find(cardId)
    if (!card) return false
    card.status = 'active'
    card.enabled = true
    card.lastReviewedAt = Date.now()
    card.updatedAt = card.lastReviewedAt
    this.flush()
    return true
  }

  /** 驳回：标记 rejected，不再参与检索。 */
  reject(cardId: string): boolean {
    const card = this.find(cardId)
    if (!card) return false
    card.status = 'rejected'
    card.lastReviewedAt = Date.now()
    card.updatedAt = card.lastReviewedAt
    this.flush()
    return true
  }

  /** 检索注入埋点：被选中注入即 retrieved+1。 */
  recordRetrieved(cardIds: string[]): void {
    this.bump(cardIds, (card) => {
      card.stats.retrieved += 1
    })
  }

  /** 应用埋点：某步实际引用了卡片（act/send），按动作结果记 verifiedSuccess/Failure。 */
  recordApplied(cardIds: string[], outcome: 'ok' | 'fail' | 'skip'): void {
    this.bump(cardIds, (card) => {
      card.stats.applied += 1
      if (outcome === 'ok') card.stats.verifiedSuccess += 1
      else if (outcome === 'fail') card.stats.verifiedFailure += 1
    })
  }

  /** 人工推翻埋点：引用了某卡片的步骤被人工纠正，humanOverride+1（最强负反馈）。 */
  recordHumanOverride(cardIds: string[]): void {
    this.bump(cardIds, (card) => {
      card.stats.humanOverride += 1
    })
  }

  private find(cardId: string): ExperienceCard | undefined {
    return this.load().find((card) => card.cardId === cardId)
  }

  private bump(cardIds: string[], mutate: (card: ExperienceCard) => void): void {
    if (cardIds.length === 0) return
    const cards = this.load()
    let changed = false
    for (const cardId of cardIds) {
      const card = cards.find((item) => item.cardId === cardId)
      if (!card) continue
      mutate(card)
      card.updatedAt = Date.now()
      changed = true
    }
    if (changed) this.flush()
  }

  private load(): ExperienceCard[] {
    if (this.cards) return this.cards
    let loaded: ExperienceCard[] = []
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'))
      const list: unknown[] = Array.isArray(raw?.cards) ? raw.cards : []
      loaded = list.map(migrateCard).filter((card): card is ExperienceCard => card !== null)
    } catch {
      loaded = []
    }
    this.cards = loaded
    return loaded
  }

  private flush(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      writeFileSync(
        this.filePath,
        `${JSON.stringify({ version: STORE_FILE_VERSION, cards: this.cards ?? [] }, null, 2)}\n`,
        'utf8'
      )
    } catch (error) {
      console.error('[ExperienceStore] 经验卡片写入失败:', error)
    }
  }
}

// ── 小工具（纯函数） ──

function isMemoryKind(value: unknown): value is MemoryKind {
  return (
    value === 'event' || value === 'procedure' || value === 'decision' || value === 'constraint'
  )
}

function isMemoryStatus(value: unknown): value is MemoryStatus {
  return (
    value === 'pending_review' ||
    value === 'active' ||
    value === 'rejected' ||
    value === 'deprecated'
  )
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === 'low' || value === 'medium' || value === 'high'
}

function clamp01(value: number | undefined, fallback: number): number {
  if (value === undefined || Number.isNaN(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function normalizeScope(raw: unknown): MemoryScope | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const strList = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : undefined
  const scope: MemoryScope = {
    appTypes: strList(r.appTypes) as AppType[] | undefined,
    taskTypes: strList(r.taskTypes),
    tags: strList(r.tags)
  }
  const hasAny =
    (scope.appTypes?.length ?? 0) > 0 ||
    (scope.taskTypes?.length ?? 0) > 0 ||
    (scope.tags?.length ?? 0) > 0
  return hasAny ? scope : undefined
}
