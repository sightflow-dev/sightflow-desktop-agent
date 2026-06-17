import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExperienceStore, migrateCard } from './experience-store'

function tmpStorePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-exp-'))
  return path.join(dir, 'cards.json')
}

test('migrateCard: 旧 {used,success} 迁移到新 stats，补默认 status/kind', () => {
  const legacy = {
    cardId: 'legacy-1',
    scenario: '客户询价',
    guidance: '先确认需求',
    rationale: '避免比价',
    source: 'agent_summary',
    evidence: { sessionId: 's1' },
    enabled: true,
    stats: { used: 4, success: 3 },
    createdAt: 1000
  }
  const card = migrateCard(legacy)
  assert.ok(card)
  assert.equal(card!.status, 'active') // 历史卡片保持「启用即可注入」
  assert.equal(card!.kind, 'procedure')
  assert.equal(card!.stats.applied, 4)
  assert.equal(card!.stats.verifiedSuccess, 3)
  assert.equal(card!.stats.retrieved, 4)
  assert.equal(card!.version, 1)
})

test('migrateCard: 非法对象返回 null', () => {
  assert.equal(migrateCard(null), null)
  assert.equal(migrateCard({ scenario: 'x' }), null) // 缺 guidance
})

test('human_takeover 默认进 pending_review，不可被检索；manual 直接 active', () => {
  const store = new ExperienceStore(tmpStorePath())
  const [correction] = store.addCards([
    { scenario: '报价异议', guidance: '先发案例', source: 'human_takeover' }
  ])
  const [manual] = store.addCards([{ scenario: '开场', guidance: '先问需求', source: 'manual' }])

  assert.equal(correction.status, 'pending_review')
  assert.equal(manual.status, 'active')

  const retrievable = store.getRetrievableCards().map((c) => c.cardId)
  assert.ok(retrievable.includes(manual.cardId))
  assert.ok(!retrievable.includes(correction.cardId))
})

test('approve: pending_review → active 后才可被检索；reject 排除', () => {
  const store = new ExperienceStore(tmpStorePath())
  const [c] = store.addCards([{ scenario: 's', guidance: 'g', source: 'human_takeover' }])
  assert.equal(store.getRetrievableCards().length, 0)

  assert.equal(store.approve(c.cardId), true)
  assert.equal(store.getRetrievableCards().length, 1)

  assert.equal(store.reject(c.cardId), true)
  assert.equal(store.getRetrievableCards().length, 0)
})

test('disabled 的 active 卡片不参与检索', () => {
  const store = new ExperienceStore(tmpStorePath())
  const [c] = store.addCards([{ scenario: 's', guidance: 'g', source: 'manual' }])
  store.setEnabled(c.cardId, false)
  assert.equal(store.getRetrievableCards().length, 0)
})

test('埋点：retrieved / applied(verifiedSuccess|Failure) / humanOverride', () => {
  const store = new ExperienceStore(tmpStorePath())
  const [c] = store.addCards([{ scenario: 's', guidance: 'g', source: 'manual' }])

  store.recordRetrieved([c.cardId])
  store.recordApplied([c.cardId], 'ok')
  store.recordApplied([c.cardId], 'fail')
  store.recordHumanOverride([c.cardId])

  const reloaded = store.listCards().find((x) => x.cardId === c.cardId)!
  assert.equal(reloaded.stats.retrieved, 1)
  assert.equal(reloaded.stats.applied, 2)
  assert.equal(reloaded.stats.verifiedSuccess, 1)
  assert.equal(reloaded.stats.verifiedFailure, 1)
  assert.equal(reloaded.stats.humanOverride, 1)
})

test('持久化：写盘后新实例能读回迁移结果', () => {
  const file = tmpStorePath()
  const store = new ExperienceStore(file)
  const [c] = store.addCards([{ scenario: 's', guidance: 'g', source: 'manual' }])
  store.recordRetrieved([c.cardId])

  const reopened = new ExperienceStore(file)
  const got = reopened.listCards()
  assert.equal(got.length, 1)
  assert.equal(got[0].stats.retrieved, 1)
})

test('向后兼容：直接读取 v1 旧文件（{used,success}）', () => {
  const file = tmpStorePath()
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      cards: [
        {
          cardId: 'old',
          scenario: 's',
          guidance: 'g',
          rationale: '',
          source: 'manual',
          evidence: {},
          enabled: true,
          stats: { used: 2, success: 1 },
          createdAt: 1
        }
      ]
    })
  )
  const store = new ExperienceStore(file)
  const cards = store.listCards()
  assert.equal(cards.length, 1)
  assert.equal(cards[0].stats.applied, 2)
  assert.equal(cards[0].status, 'active')
  assert.ok(store.getRetrievableCards().length === 1)

  // 触发一次写入后文件升级到 version 2
  store.recordRetrieved(['old'])
  const persisted = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(persisted.version, 2)
})
