import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import type { ExperienceCard } from './experience-store'
import {
  DEFAULT_RETRIEVAL_POLICY,
  isScopeEligible,
  retrieveCards,
  scoreCard,
  textRelevance
} from './memory-retriever'

const NOW = 1_700_000_000_000

function makeCard(over: Partial<ExperienceCard> = {}): ExperienceCard {
  return {
    cardId: over.cardId ?? Math.random().toString(36).slice(2),
    kind: 'procedure',
    status: 'active',
    scenario: '客户询问报价',
    guidance: '先确认需求再报价区间',
    rationale: '直接报价容易被比价',
    source: 'manual',
    confidence: 0.7,
    riskLevel: 'low',
    version: 1,
    evidence: {},
    enabled: true,
    stats: { retrieved: 0, applied: 0, verifiedSuccess: 0, verifiedFailure: 0, humanOverride: 0 },
    createdAt: NOW,
    updatedAt: NOW,
    ...over
  }
}

test('isScopeEligible: appType 作用域硬过滤', () => {
  const scoped = makeCard({ scope: { appTypes: ['wechat'] } })
  assert.equal(isScopeEligible(scoped, { appType: 'wechat' }), true)
  assert.equal(isScopeEligible(scoped, { appType: 'slack' }), false)
  // 无作用域 → 不限制，向后兼容旧卡片
  assert.equal(isScopeEligible(makeCard(), { appType: 'slack' }), true)
})

test('retrieveCards: 作用域不匹配的被排除', () => {
  const cards = [
    makeCard({ cardId: 'a', scope: { appTypes: ['wechat'] } }),
    makeCard({ cardId: 'b', scope: { appTypes: ['slack'] } })
  ]
  const picked = retrieveCards(cards, { appType: 'wechat' }, DEFAULT_RETRIEVAL_POLICY, NOW)
  assert.deepEqual(
    picked.map((c) => c.cardId),
    ['a']
  )
})

test('retrieveCards: 受 maxItems 约束', () => {
  const cards = Array.from({ length: 10 }, (_, i) => makeCard({ cardId: `c${i}` }))
  const picked = retrieveCards(cards, {}, { maxItems: 3, maxChars: 100_000, minScore: 0 }, NOW)
  assert.equal(picked.length, 3)
})

test('retrieveCards: 字符预算限制注入条数，但至少放一条', () => {
  const big = makeCard({
    cardId: 'big',
    scenario: 'x'.repeat(500),
    guidance: 'y'.repeat(500),
    rationale: ''
  })
  const small = makeCard({ cardId: 'small', confidence: 0.1 })
  // 预算只够一条长卡，且 big 分更高（confidence 0.7 vs 0.1）→ 先放 big，small 超预算被挡
  const picked = retrieveCards([big, small], {}, { maxItems: 5, maxChars: 600, minScore: 0 }, NOW)
  assert.deepEqual(
    picked.map((c) => c.cardId),
    ['big']
  )
})

test('retrieveCards: 单条超预算也至少返回一条（不被全挡）', () => {
  const huge = makeCard({ cardId: 'huge', scenario: 'z'.repeat(5000) })
  const picked = retrieveCards([huge], {}, { maxItems: 5, maxChars: 10, minScore: 0 }, NOW)
  assert.equal(picked.length, 1)
})

test('textRelevance: 词重叠提升相关性', () => {
  const card = makeCard({ scenario: '报价 异议 处理', guidance: '先发案例' })
  assert.ok(textRelevance(card, { text: '客户报价异议' }) > 0)
  assert.equal(textRelevance(card, { text: '完全无关的内容词' }), 0)
  // 无 query 文本 → 0（退化为纯质量排序）
  assert.equal(textRelevance(card, {}), 0)
})

test('scoreCard: 人工推翻拉低分数', () => {
  const clean = makeCard({ cardId: 'clean' })
  const overridden = makeCard({
    cardId: 'bad',
    stats: { retrieved: 5, applied: 5, verifiedSuccess: 0, verifiedFailure: 3, humanOverride: 4 }
  })
  assert.ok(scoreCard(clean, {}, NOW) > scoreCard(overridden, {}, NOW))
})

test('scoreCard: 时间衰减使新卡更高', () => {
  const fresh = makeCard({ cardId: 'fresh', createdAt: NOW })
  const old = makeCard({ cardId: 'old', createdAt: NOW - 120 * 24 * 60 * 60 * 1000 })
  assert.ok(scoreCard(fresh, {}, NOW) > scoreCard(old, {}, NOW))
})
