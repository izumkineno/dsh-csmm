import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAllowed, sectionAllowlist, toolAllowlist } from '../../src/shared/policy'
import type { GroupRecord } from '../../src/shared/types'

const scope = { kind: 'global' as const }

function group(items: GroupRecord['items']): GroupRecord {
  return { id: 'g', name: 'g', scope, enabled: true, items }
}

test('no group: section filtering is off', () => {
  const allow = sectionAllowlist(undefined)
  assert.equal(allow.active, false)
  assert.equal(isAllowed(allow, 'harness:identity'), true)
})

test('empty group: section filtering is on and allows nothing', () => {
  const allow = sectionAllowlist(group([]))
  assert.equal(allow.active, true)
  assert.deepEqual(allow.names, [])
  assert.equal(isAllowed(allow, 'harness:identity'), false)
})

test('group section items are deduplicated and kept in order', () => {
  const allow = sectionAllowlist(group([
    { kind: 'section', name: 'b' },
    { kind: 'section', name: 'a' },
    { kind: 'section', name: 'b' },
    { kind: 'tool', name: 'grep' },
  ]))
  assert.deepEqual(allow.names, ['b', 'a'])
})

test('no group: tool filtering is off', () => {
  const allow = toolAllowlist(undefined)
  assert.equal(allow.active, false)
  assert.equal(isAllowed(allow, 'grep'), true)
})

test('empty tool list denies every tool', () => {
  const allow = toolAllowlist(group([]))
  assert.equal(allow.active, true)
  assert.deepEqual(allow.names, [])
  assert.equal(isAllowed(allow, 'grep'), false)
})

test('selected tools are kept and run_code / blanks are dropped', () => {
  const allow = toolAllowlist(group([
    { kind: 'tool', name: 'grep' },
    { kind: 'tool', name: 'run_code' },
    { kind: 'tool', name: '' },
    { kind: 'tool', name: 'grep' },
  ]))
  assert.deepEqual(allow.names, ['grep'])
  assert.equal(isAllowed(allow, 'grep'), true)
  assert.equal(isAllowed(allow, 'bash'), false)
})
