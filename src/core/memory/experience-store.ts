// src/core/memory/experience-store.ts
// 经验卡片存储 — 过程性记忆的最小单元
//
// 卡片来源三种：agent_summary（LLM 从轨迹归纳）、human_takeover（人工纠正）、
// manual（手动录入）。运行时把启用的卡片注入 provider prompt；每次注入后
// 回复发送成功即记一次 used/success，让「这条经验有没有用」可量化。
//
// 存储：单个 JSON 文件（<userData>/worktrace/memory/cards.json），同步读写——
// 卡片量级在百以内，不值得引入数据库；Phase 1 工程化时迁移 SQLite。

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MemoryCardBrief } from '../trace/trace-types'

export type ExperienceCardSource = 'agent_summary' | 'human_takeover' | 'manual'

export interface ExperienceCard {
  cardId: string
  /** 触发条件：什么情况下适用 */
  scenario: string
  /** 该怎么做 */
  guidance: string
  /** 为什么——老员工的判断依据 */
  rationale: string
  source: ExperienceCardSource
  /** 来源轨迹（可审计：每张卡片能回溯到出处） */
  evidence: { sessionId?: string; stepIds?: string[] }
  enabled: boolean
  stats: { used: number; success: number }
  createdAt: number
}

export interface NewExperienceCard {
  scenario: string
  guidance: string
  rationale?: string
  source: ExperienceCardSource
  evidence?: { sessionId?: string; stepIds?: string[] }
}

// ── 检索 / 门控调参 ──
/** recency 指数衰减半衰期（毫秒）：14 天前的卡片新近度权重降到一半 */
const RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000
/** 三因子打分权重：相关度优先，其次重要度，再次新近度 */
const W_RECENCY = 1
const W_IMPORTANCE = 1.5
const W_RELEVANCE = 2
/** Voyager 门控：积累到这么多次引用后才考虑因低成功率而停用（证据门槛，避免误杀新卡片） */
const RETIRE_MIN_USES = 8
/** 成功率低于此阈值才自动停用 */
const RETIRE_MAX_SUCCESS_RATE = 0.25

export class ExperienceStore {
  private cards: ExperienceCard[] | null = null

  constructor(private readonly filePath: string) {}

  listCards(): ExperienceCard[] {
    return [...this.load()].sort((a, b) => b.createdAt - a.createdAt)
  }

  getActiveCards(): ExperienceCard[] {
    return this.load().filter((card) => card.enabled)
  }

  getActiveCardBriefs(): MemoryCardBrief[] {
    return this.getActiveCards().map(toBrief)
  }

  /**
   * 运行时检索：取与当前场景最相关的 top-K 张卡片（替代「全量注入」，控制 prompt 体积 = 上下文压缩的第一步）。
   * 打分参考 Generative-Agents 的 recency + importance + relevance 三因子：
   *   - recency    新近度，按创建时间指数衰减（半衰期 14 天）
   *   - importance 重要度，用卡片历史成功率（Laplace 平滑，新卡片给中性先验，不被埋没）
   *   - relevance  相关度，query 与卡片文本的词法重合（暂用词法代理；接入 embeddings 后可升级为语义）
   * query 当前传入 appType；后续可换成「appType + OCR/场景文本」。
   */
  getRelevantCards(query: string, topK = 5): MemoryCardBrief[] {
    const active = this.getActiveCards()
    if (active.length <= topK) return active.map(toBrief)

    const now = Date.now()
    const queryTokens = tokenize(query)
    return active
      .map((card) => ({ card, score: scoreCard(card, queryTokens, now) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((scored) => toBrief(scored.card))
  }

  addCards(inputs: NewExperienceCard[]): ExperienceCard[] {
    const cards = this.load()
    const created = inputs
      .filter((input) => input.scenario?.trim() && input.guidance?.trim())
      .map(
        (input): ExperienceCard => ({
          cardId: randomUUID(),
          scenario: input.scenario.trim(),
          guidance: input.guidance.trim(),
          rationale: input.rationale?.trim() || '',
          source: input.source,
          evidence: input.evidence ?? {},
          enabled: true,
          stats: { used: 0, success: 0 },
          createdAt: Date.now()
        })
      )
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
    const card = this.load().find((item) => item.cardId === cardId)
    if (!card) return false
    card.enabled = enabled
    this.flush()
    return true
  }

  /**
   * 一次注入后的效果回写：被引用即 used+1，回复成功发送再 success+1。
   * Voyager 式技能库门控：当一张卡片积累了足够证据（used≥RETIRE_MIN_USES）却长期低成功率
   * （成功率<RETIRE_MAX_SUCCESS_RATE）时自动停用——只保留「真的有用」的经验，避免坏经验持续污染注入。
   */
  recordUsage(cardIds: string[], success: boolean): void {
    const cards = this.load()
    let changed = false
    for (const cardId of cardIds) {
      const card = cards.find((item) => item.cardId === cardId)
      if (!card) continue
      card.stats.used += 1
      if (success) card.stats.success += 1
      changed = true

      if (
        card.enabled &&
        card.stats.used >= RETIRE_MIN_USES &&
        card.stats.success / card.stats.used < RETIRE_MAX_SUCCESS_RATE
      ) {
        card.enabled = false
        console.warn(
          `[ExperienceStore] 经验卡片 ${card.cardId} 成功率过低（${card.stats.success}/${card.stats.used}），已自动停用`
        )
      }
    }
    if (changed) this.flush()
  }

  private load(): ExperienceCard[] {
    if (this.cards) return this.cards
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'))
      this.cards = Array.isArray(raw?.cards) ? (raw.cards as ExperienceCard[]) : []
    } catch {
      this.cards = []
    }
    return this.cards
  }

  private flush(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      writeFileSync(
        this.filePath,
        `${JSON.stringify({ version: 1, cards: this.cards ?? [] }, null, 2)}\n`,
        'utf8'
      )
    } catch (error) {
      console.error('[ExperienceStore] 经验卡片写入失败:', error)
    }
  }
}

function toBrief(card: ExperienceCard): MemoryCardBrief {
  return {
    cardId: card.cardId,
    scenario: card.scenario,
    guidance: card.guidance,
    rationale: card.rationale || undefined
  }
}

/** Generative-Agents 风格三因子打分：recency × importance × relevance 加权求和（各项归一化到 0..1）。 */
function scoreCard(card: ExperienceCard, queryTokens: string[], now: number): number {
  const ageMs = Math.max(0, now - card.createdAt)
  const recency = Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS)
  // Laplace 平滑：未使用过的卡片成功率取中性 0.5，不被埋没也不被高估
  const importance = (card.stats.success + 1) / (card.stats.used + 2)
  const relevance = lexicalRelevance(queryTokens, card)
  return W_RECENCY * recency + W_IMPORTANCE * importance + W_RELEVANCE * relevance
}

/** 词法相关度：query token 在卡片文本中命中的比例（0..1）。embeddings 接入后可替换为语义相似度。 */
function lexicalRelevance(queryTokens: string[], card: ExperienceCard): number {
  if (queryTokens.length === 0) return 0
  const haystack = `${card.scenario} ${card.guidance} ${card.rationale}`.toLowerCase()
  const hits = queryTokens.filter((token) => haystack.includes(token)).length
  return hits / queryTokens.length
}

/** 轻量分词：英文按非字母数字切分，中文按单字切分，去重去空。 */
function tokenize(text: string): string[] {
  const tokens = new Set<string>()
  for (const part of text.toLowerCase().split(/[^a-z0-9一-鿿]+/)) {
    if (!part) continue
    if (/^[a-z0-9]+$/.test(part)) {
      tokens.add(part)
    } else {
      // 含中文：逐字加入（中文无空格，单字命中比整段更稳）
      for (const ch of part) if (/[一-鿿]/.test(ch)) tokens.add(ch)
    }
  }
  return [...tokens]
}
