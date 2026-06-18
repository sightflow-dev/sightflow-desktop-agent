import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import type { RawDomElement } from './browser-driver'
import { indexElements, isInteractiveRole, resolveTarget, serializeElements } from './dom-elements'

const RAW: RawDomElement[] = [
  { role: 'input', name: '搜索', selector: '[data-sf-idx="0"]', bbox: [0, 0, 100, 20] },
  { role: 'button', name: '发送', selector: '[data-sf-idx="1"]', bbox: [200, 400, 260, 430] },
  { role: 'div', name: '一段说明文字', selector: '[data-sf-idx="2"]' },
  { role: 'a', name: '查看详情', selector: '[data-sf-idx="3"]', bbox: [10, 500, 80, 520] }
]

test('isInteractiveRole: 区分可交互角色', () => {
  assert.equal(isInteractiveRole('button'), true)
  assert.equal(isInteractiveRole('INPUT'), true)
  assert.equal(isInteractiveRole('div'), false)
})

test('indexElements: 编号 + 标记 interactive', () => {
  const els = indexElements(RAW)
  assert.equal(els.length, 4)
  assert.equal(els[0].index, 0)
  assert.equal(els[1].index, 1)
  assert.equal(els[2].interactive, false) // div
  assert.equal(els[1].interactive, true) // button
})

test('serializeElements: 只列可交互，格式 [i]<role>name</role>', () => {
  const text = serializeElements(indexElements(RAW))
  const lines = text.split('\n')
  assert.equal(lines.length, 3) // input + button + a（div 被过滤）
  assert.equal(lines[1], '[1]<button>发送</button>')
  assert.ok(!text.includes('一段说明文字'))
})

test('resolveTarget: 显式编号 [1]', () => {
  const els = indexElements(RAW)
  const r = resolveTarget(els, { semanticTarget: '[1]' })
  assert.equal(r?.index, 1)
  assert.equal(r?.name, '发送')
})

test('resolveTarget: 名称完全匹配', () => {
  const els = indexElements(RAW)
  assert.equal(resolveTarget(els, { semanticTarget: '发送' })?.index, 1)
})

test('resolveTarget: 模糊包含', () => {
  const els = indexElements(RAW)
  assert.equal(resolveTarget(els, { semanticTarget: '发送按钮' })?.index, 1)
})

test('resolveTarget: 不匹配可交互元素时返回 null（不乱点 div）', () => {
  const els = indexElements(RAW)
  assert.equal(resolveTarget(els, { semanticTarget: '一段说明文字' }), null)
  assert.equal(resolveTarget(els, { semanticTarget: '完全不存在的目标xyz' }), null)
})

test('resolveTarget: 带 bbox 时取中心最近的可交互元素', () => {
  const els = indexElements(RAW)
  const r = resolveTarget(els, { bbox: [205, 405, 255, 425] }) // 贴近 button
  assert.equal(r?.index, 1)
})
