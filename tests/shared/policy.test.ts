import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAllowed, sectionAllowlist, toolAllowlist } from '../../src/shared/policy'
import type { GroupRecord } from '../../src/shared/types'

const scope = { kind: 'global' as const }

function group(items: GroupRecord['items'], toolsMode?: GroupRecord['toolsMode']): GroupRecord {
  return { id: 'g', name: 'g', scope, enabled: true, items, toolsMode }
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

test('tools without explicit takeover are not filtered', () => {
  const allow = toolAllowlist(group([{ kind: 'tool', name: 'grep' }]))
  assert.equal(allow.active, false)
  assert.equal(isAllowed(allow, 'grep'), true)
})

test('tools takeover with no selection denies every tool', () => {
  const allow = toolAllowlist(group([], 'allow'))
  assert.equal(allow.active, true)
  assert.deepEqual(allow.names, [])
  assert.equal(isAllowed(allow, 'grep'), false)
})

test('tools takeover keeps selected tools and drops run_code / blanks', () => {
  const allow = toolAllowlist(group([
    { kind: 'tool', name: 'grep' },
    { kind: 'tool', name: 'run_code' },
    { kind: 'tool', name: '' },
    { kind: 'tool', name: 'grep' },
  ], 'allow'))
  assert.deepEqual(allow.names, ['grep'])
  assert.equal(isAllowed(allow, 'grep'), true)
  assert.equal(isAllowed(allow, 'bash'), false)
})
