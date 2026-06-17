import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendHumanInterventionStep, readTraceSession, TraceRecorder } from './trace-recorder'
import { CURRENT_TRACE_SCHEMA_VERSION, normalizeTraceStep, type TraceStep } from './trace-types'

function tmpBase(): string {
  return mkdtempSync(path.join(tmpdir(), 'sf-trace-'))
}

test('normalizeTraceStep: 历史步骤补 schemaVersion=0 与 actor', () => {
  const legacy = { stepId: 's', sessionId: 'x', seq: 1, ts: 1, phase: 'think', summary: 'hi' }
  const norm = normalizeTraceStep(legacy as unknown as TraceStep)
  assert.equal(norm.schemaVersion, '0')
  assert.equal(norm.actor, 'agent')
  // 新步骤原样返回
  const fresh = normalizeTraceStep({
    schemaVersion: '1.0',
    stepId: 's',
    sessionId: 'x',
    seq: 1,
    ts: 1,
    actor: 'agent',
    phase: 'observe',
    summary: 'ok'
  })
  assert.equal(fresh.schemaVersion, '1.0')
})

test('recorder: 新步骤带 schemaVersion，可读回', async () => {
  const base = tmpBase()
  const rec = new TraceRecorder(base)
  const session = rec.startSession({ appType: 'wechat', engineVersion: '1.0.0' })
  rec.record({ phase: 'observe', summary: '截图' })
  rec.record({
    phase: 'act',
    summary: '发送回复',
    action: { kind: 'send', payload: 'hi' },
    outcome: { status: 'ok' }
  })
  rec.endSession()

  // 等写链落盘
  await new Promise((r) => setTimeout(r, 50))
  const data = await readTraceSession(base, session.sessionId)
  assert.ok(data)
  assert.equal(data!.session.schemaVersion, CURRENT_TRACE_SCHEMA_VERSION)
  assert.equal(data!.steps.length, 2)
  assert.equal(data!.steps[0].schemaVersion, CURRENT_TRACE_SCHEMA_VERSION)
  assert.equal(data!.steps[1].action?.kind, 'send')
})

test('readTraceSession: 历史 jsonl（无 schemaVersion）被归一化读取', async () => {
  const base = tmpBase()
  const sid = 'legacy-session'
  const dir = path.join(base, 'sessions', sid)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'session.json'),
    JSON.stringify({
      sessionId: sid,
      appType: 'wechat',
      startedAt: 1,
      engineVersion: '0.9.0',
      stepCount: 1
    })
  )
  writeFileSync(
    path.join(dir, 'trace.jsonl'),
    JSON.stringify({ stepId: 'a', sessionId: sid, seq: 1, ts: 1, phase: 'think', summary: '旧' }) +
      '\n'
  )
  const data = await readTraceSession(base, sid)
  assert.ok(data)
  assert.equal(data!.steps[0].schemaVersion, '0')
  assert.equal(data!.steps[0].actor, 'agent')
})

test('appendHumanInterventionStep: 会话结束后追加人工步骤并 bump stepCount', async () => {
  const base = tmpBase()
  const rec = new TraceRecorder(base)
  const session = rec.startSession({ appType: 'wechat', engineVersion: '1.0.0' })
  rec.record({ phase: 'act', summary: '发送回复' })
  rec.endSession()
  await new Promise((r) => setTimeout(r, 50))

  const step = await appendHumanInterventionStep(base, session.sessionId, {
    summary: '人工纠正：报价场景',
    reasoning: { content: '先确认需求' },
    intervention: {
      interventionId: 'iv1',
      type: 'edit',
      beforeStepId: 'whatever',
      ts: Date.now()
    }
  })
  assert.ok(step)
  assert.equal(step!.actor, 'human')
  assert.equal(step!.seq, 2)

  const data = await readTraceSession(base, session.sessionId)
  assert.equal(data!.session.stepCount, 2)
  assert.equal(data!.steps.length, 2)
  assert.equal(data!.steps[1].intervention?.type, 'edit')
})
