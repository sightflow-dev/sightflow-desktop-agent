import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { describeTarget, hasSideEffect } from './action-types'

test('hasSideEffect: 发送/输入/粘贴/开链接有副作用，观察/点击无', () => {
  assert.equal(hasSideEffect('send'), true)
  assert.equal(hasSideEffect('type'), true)
  assert.equal(hasSideEffect('paste'), true)
  assert.equal(hasSideEffect('open_url'), true)
  assert.equal(hasSideEffect('click'), false)
  assert.equal(hasSideEffect('observe'), false)
  assert.equal(hasSideEffect('measure'), false)
})

test('describeTarget: 优先语义目标 > bbox > 坐标', () => {
  assert.equal(
    describeTarget({ semanticTarget: '微信搜索框', bbox: [1, 2, 3, 4], coords: [10, 20] }),
    '微信搜索框'
  )
  assert.equal(describeTarget({ bbox: [1, 2, 3, 4], coords: [10, 20] }), 'bbox(1,2,3,4)')
  assert.equal(describeTarget({ coords: [10, 20] }), '(10,20)')
  assert.equal(describeTarget({}), undefined)
  assert.equal(describeTarget(undefined), undefined)
})
