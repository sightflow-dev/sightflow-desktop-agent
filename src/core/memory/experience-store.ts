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
    return this.getActiveCards().map((card) => ({
      cardId: card.cardId,
      scenario: card.scenario,
      guidance: card.guidance,
      rationale: card.rationale || undefined
    }))
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

  /** 一次注入后的效果回写：被引用即 used+1，回复成功发送再 success+1 */
  recordUsage(cardIds: string[], success: boolean): void {
    const cards = this.load()
    let changed = false
    for (const cardId of cardIds) {
      const card = cards.find((item) => item.cardId === cardId)
      if (!card) continue
      card.stats.used += 1
      if (success) card.stats.success += 1
      changed = true
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
