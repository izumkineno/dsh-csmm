import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activationImpact, buildActivationGroup } from '../../src/shared/group'

const section = { kind: 'section' as const, name: 'section:a' }
const tool = { kind: 'tool' as const, name: 'read' }

test('buildActivationGroup replaces items and keeps other fields', () => {
  const source = {
    id: 'g1',
    name: 'daily',
    scope: { kind: 'global' as const },
    enabled: true,
    items: [section],
  }
  const next = buildActivationGroup(source, [section, tool])
  assert.equal(next.id, 'g1')
  assert.equal(next.name, 'daily')
  assert.equal(next.enabled, true)
  assert.deepEqual(next.items, [section, tool])
  assert.notEqual(next.items, source.items)
  assert.deepEqual(source.items, [section])
})

test('activationImpact flags empty group, no sections and no tools', () => {
  assert.deepEqual(activationImpact({ items: [] }), {
    sections: 0,
    tools: 0,
    emptyGroup: true,
    noSections: true,
    noTools: true,
  })
  assert.deepEqual(activationImpact({ items: [tool] }), {
    sections: 0,
    tools: 1,
    emptyGroup: false,
    noSections: true,
    noTools: false,
  })
  assert.deepEqual(activationImpact({ items: [section] }), {
    sections: 1,
    tools: 0,
    emptyGroup: false,
    noSections: false,
    noTools: true,
  })
})
