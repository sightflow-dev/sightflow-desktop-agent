import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import type { Action } from '../action/action-types'
import type { BrowserDriver, BrowserSnapshot } from './browser-driver'
import { BrowserSurface } from './browser-surface'

const SNAPSHOT: BrowserSnapshot = {
  url: 'https://example.com/chat',
  title: 'Chat',
  elements: [
    { role: 'input', name: '搜索', selector: '#search', bbox: [0, 0, 100, 20] },
    { role: 'button', name: '发送', selector: '#send', bbox: [200, 400, 260, 430] },
    { role: 'textbox', name: '消息输入框', selector: '#msg', bbox: [0, 380, 180, 420] }
  ]
}

class FakeDriver implements BrowserDriver {
  calls: string[] = []
  async goto(url: string): Promise<void> {
    this.calls.push(`goto:${url}`)
  }
  async snapshot(): Promise<BrowserSnapshot> {
    this.calls.push('snapshot')
    return SNAPSHOT
  }
  async clickSelector(selector: string): Promise<void> {
    this.calls.push(`click:${selector}`)
  }
  async fillSelector(selector: string, text: string): Promise<void> {
    this.calls.push(`fill:${selector}:${text}`)
  }
  async pressKey(key: string): Promise<void> {
    this.calls.push(`press:${key}`)
  }
  async scroll(dx: number, dy: number): Promise<void> {
    this.calls.push(`scroll:${dx},${dy}`)
  }
  async close(): Promise<void> {
    this.calls.push('close')
  }
}

const click = (semanticTarget: string): Action => ({
  kind: 'click',
  surface: 'browser',
  target: { semanticTarget }
})

test('observe: 构造 elementsText 与编号元素', async () => {
  const d = new FakeDriver()
  const s = new BrowserSurface(d)
  const obs = await s.observe()
  assert.equal(obs.kind, 'browser')
  assert.equal(obs.url, 'https://example.com/chat')
  assert.equal(obs.elements.length, 3)
  assert.ok(obs.elementsText.includes('[1]<button>发送</button>'))
})

test('open_url → driver.goto', async () => {
  const d = new FakeDriver()
  const s = new BrowserSurface(d)
  const r = await s.act({ kind: 'open_url', surface: 'browser', payload: 'https://x.com' })
  assert.equal(r.ok, true)
  assert.ok(d.calls.includes('goto:https://x.com'))
})

test('click：先 observe 再接地，调用正确 selector，回报 resolved', async () => {
  const d = new FakeDriver()
  const s = new BrowserSurface(d)
  const r = await s.act(click('发送'))
  assert.equal(r.ok, true)
  assert.equal(r.groundingSource, 'dom')
  assert.equal(r.resolved?.index, 1)
  assert.equal(r.resolved?.semanticTarget, '发送')
  assert.ok(d.calls.includes('click:#send'))
})

test('send：填充输入框并回车', async () => {
  const d = new FakeDriver()
  const s = new BrowserSurface(d)
  await s.observe()
  const r = await s.act({
    kind: 'send',
    surface: 'browser',
    target: { semanticTarget: '消息输入框' },
    payload: '你好'
  })
  assert.equal(r.ok, true)
  assert.ok(d.calls.includes('fill:#msg:你好'))
  assert.ok(d.calls.includes('press:Enter'))
})

test('scroll：解析 payload', async () => {
  const d = new FakeDriver()
  const s = new BrowserSurface(d)
  await s.act({ kind: 'scroll', surface: 'browser', payload: '0,800' })
  assert.ok(d.calls.includes('scroll:0,800'))
})

test('目标无法接地 → ok:false，不乱点', async () => {
  const d = new FakeDriver()
  const s = new BrowserSurface(d)
  const r = await s.act(click('页面上不存在的按钮zzz'))
  assert.equal(r.ok, false)
  assert.ok(r.error && r.error.includes('未能在页面上定位'))
  assert.ok(!d.calls.some((c) => c.startsWith('click:')))
})
