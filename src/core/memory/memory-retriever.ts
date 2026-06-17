// src/core/memory/memory-retriever.ts
// 工作记忆检索 — 按当前任务场景挑 top-k 经验卡片注入，而不是全量灌给模型。
//
// 解决 doc §5.3 的反模式：active 卡片越攒越多 → token 膨胀 / 错误经验污染 /
// 场景不匹配。检索分两段（doc §11）：
//   1. 硬过滤：作用域（appType/taskType/tags）不匹配的直接排除；
//   2. 软排序：质量分（置信度 × 结果质量 × 时间衰减 − 风险/推翻惩罚）+ 文本相关性，
//      取分高者，受 maxItems 与字符预算（token 近似）双重约束。
//
// 纯函数、无 IO、无 electron 依赖，可独立单测。调用方（main）负责取 active 卡片、
// 回写 retrieved 埋点。

import type { AppType } from '../rpa/types'
import type { MemoryCardBrief } from '../trace/trace-types'
import type { ExperienceCard } from './experience-store'

/** 检索查询：运行时从 ProviderInput 构造（界面对应的应用 / 联系人 / 可得文本）。 */
export interface MemoryQuery {
  appType?: AppType
  taskType?: string
  /** 自由文本（联系人名 / OCR / 最近消息），用于相关性排序；为空则纯按质量排。 */
  text?: string
  tags?: string[]
}

export interface MemoryRetrievalPolicy {
  maxItems: number
  /** 注入文本字符预算（token 近似，无需引 tokenizer） */
  maxChars: number
  /** 低于该分数的卡片不注入 */
  minScore: number
}

export const DEFAULT_RETRIEVAL_POLICY: MemoryRetrievalPolicy = {
  maxItems: 5,
  maxChars: 1600,
  minScore: 0.05
}

const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000 // 30 天半衰期

/** 卡片占用的字符数（注入预算计量口径，与 brief 注入内容对齐） */
export function cardCharCost(card: ExperienceCard): number {
  return card.scenario.length + card.guidance.length + card.rationale.length
}

/**
 * 作用域硬过滤：卡片声明了某维度且与 query 冲突 → 不可用。
 * 维度留空表示「不限制」，因此默认放行（向后兼容无 scope 的旧卡片）。
 */
export function isScopeEligible(card: ExperienceCard, query: MemoryQuery): boolean {
  const scope = card.scope
  if (!scope) return true
  if (scope.appTypes?.length && query.appType && !scope.appTypes.includes(query.appType)) {
    return false
  }
  if (scope.taskTypes?.length && query.taskType && !scope.taskTypes.includes(query.taskType)) {
    return false
  }
  return true
}

/** 结果质量：拉普拉斯平滑的验证成功率，再按人工推翻次数打折。 */
function outcomeQuality(card: ExperienceCard): number {
  const { verifiedSuccess, verifiedFailure, humanOverride } = card.stats
  const base = (verifiedSuccess + 1) / (verifiedSuccess + verifiedFailure + 2)
  const overridePenalty = 1 / (1 + humanOverride)
  return base * overridePenalty
}

function recencyDecay(card: ExperienceCard, now: number): number {
  const age = Math.max(0, now - card.createdAt)
  return Math.pow(0.5, age / RECENCY_HALF_LIFE_MS)
}

const CJK_RUN = /[㐀-鿿豈-﫿]+/gu

/**
 * 分词：拉丁/数字按非字母数字切词；中文不按空格分，按连续汉字串切「字符二元组」
 * （bigram），从而在未分词的中文文本上也能产生有意义的重叠。
 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  for (const word of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length > 1 && !CJK_RUN.test(word)) tokens.push(word)
    CJK_RUN.lastIndex = 0
  }
  for (const run of lower.match(CJK_RUN) ?? []) {
    if (run.length === 1) tokens.push(run)
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
  }
  return tokens
}

/** 文本相关性：query 文本/标签与卡片（场景+做法+标签）的词重叠占比。 */
export function textRelevance(card: ExperienceCard, query: MemoryQuery): number {
  const queryTokens = new Set([
    ...tokenize(query.text ?? ''),
    ...(query.tags ?? []).map((t) => t.toLowerCase())
  ])
  if (queryTokens.size === 0) return 0
  const cardTokens = new Set([
    ...tokenize(`${card.scenario} ${card.guidance}`),
    ...(card.scope?.tags ?? []).map((t) => t.toLowerCase())
  ])
  let hit = 0
  for (const t of queryTokens) if (cardTokens.has(t)) hit += 1
  return hit / queryTokens.size
}

/**
 * 综合分 = 质量基线 +（有文本时）相关性加权。
 * 质量基线 = confidence × outcomeQuality × recencyDecay，再按风险等级轻度打折。
 */
export function scoreCard(
  card: ExperienceCard,
  query: MemoryQuery,
  now: number = Date.now()
): number {
  const riskPenalty = card.riskLevel === 'high' ? 0.7 : card.riskLevel === 'medium' ? 0.9 : 1
  const quality = card.confidence * outcomeQuality(card) * recencyDecay(card, now) * riskPenalty
  const relevance = textRelevance(card, query)
  // 有 query 文本时相关性主导；无文本时退化为纯质量排序
  return quality * 0.5 + relevance * 0.5 + quality * relevance
}

export interface ScoredCard {
  card: ExperienceCard
  score: number
}

/**
 * 检索 top-k：硬过滤 → 打分 → 阈值过滤 → 按分降序 → 贪心填入直到 maxItems / 字符预算。
 * 返回挑中的完整卡片（调用方据此回写 retrieved 埋点 / 转 brief）。
 */
export function retrieveCards(
  cards: ExperienceCard[],
  query: MemoryQuery,
  policy: MemoryRetrievalPolicy = DEFAULT_RETRIEVAL_POLICY,
  now: number = Date.now()
): ExperienceCard[] {
  const scored: ScoredCard[] = cards
    .filter((card) => isScopeEligible(card, query))
    .map((card) => ({ card, score: scoreCard(card, query, now) }))
    .filter((s) => s.score >= policy.minScore)
    .sort((a, b) => b.score - a.score)

  const picked: ExperienceCard[] = []
  let charBudget = policy.maxChars
  for (const { card } of scored) {
    if (picked.length >= policy.maxItems) break
    const cost = cardCharCost(card)
    // 始终至少放一条（即便超预算），否则单条长卡片会被全部挡掉
    if (picked.length > 0 && cost > charBudget) continue
    picked.push(card)
    charBudget -= cost
  }
  return picked
}

export function toBrief(card: ExperienceCard): MemoryCardBrief {
  return {
    cardId: card.cardId,
    scenario: card.scenario,
    guidance: card.guidance,
    rationale: card.rationale || undefined
  }
}
