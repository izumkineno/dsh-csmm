import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  budget,
  chainFor,
  denyCount,
  effectiveItems,
  resolvedServer,
  resolvedSkill,
  shadowCount,
  visibleSkills,
  winningLayer,
} from '../../src/shared/resolve'
import type {
  CustomPromptRecord,
  GroupRecord,
  McpServerRecord,
  SectionRecord,
  SkillRecord,
  StoreDocument,
  WorkspaceRecord,
} from '../../src/shared/types'

const globalScope = { kind: 'global' as const }
const ws1 = { kind: 'workspace' as const, id: 'ws1' }
const ws2 = { kind: 'workspace' as const, id: 'ws2' }

const workspaces: WorkspaceRecord[] = [
  { id: 'ws1', title: 'one', path: '/one', trusted: true },
  { id: 'ws2', title: 'two', path: '/two', trusted: false },
]

const sections: SectionRecord[] = [
  { name: 's1', source: 'sys', tokens: 10, kind: 'section', text: 'one' },
  { name: 'ctx', source: 'runtime', tokens: 5, kind: 'context', text: 'ctx' },
]

const skills: SkillRecord[] = [
  {
    name: 'alpha',
    label: 'Alpha',
    scope: 'global',
    bytes: 20,
    model: true,
    user: false,
    desc: 'global alpha',
    text: 'global alpha text',
  },
  {
    name: 'alpha',
    label: 'Alpha Ws',
    scope: 'workspace',
    wsId: 'ws1',
    bytes: 20,
    model: true,
    user: false,
    desc: 'workspace alpha',
    text: 'workspace alpha text',
  },
  {
    name: 'beta',
    label: 'Beta',
    scope: 'workspace',
    wsId: 'ws1',
    bytes: 20,
    model: true,
    user: false,
    desc: 'beta',
    text: 'beta text',
  },
  {
    name: 'gamma',
    label: 'Gamma',
    scope: 'global',
    bytes: 20,
    model: true,
    user: false,
    desc: 'disabled',
    text: 'gamma text',
    enabled: false,
  },
  {
    name: 'delta',
    label: 'Delta',
    scope: 'global',
    bytes: 20,
    model: true,
    user: false,
    desc: 'not grouped',
    text: 'delta text',
  },
]

const servers: McpServerRecord[] = [
  {
    name: 'omd',
    label: 'omd',
    scope: 'global',
    status: 'connected',
    transport: 'stdio',
    tokens: 30,
    auth: 'none',
    tools: [
      { name: 'a', on: true },
      { name: 'b', on: false },
    ],
    instructions: '',
  },
  {
    name: 'repo',
    label: 'repo',
    scope: 'workspace',
    wsId: 'ws1',
    status: 'connected',
    transport: 'stdio',
    tokens: 12,
    auth: 'none',
    tools: [
      { name: 'x', on: true },
      { name: 'y', on: true },
    ],
    instructions: '',
  },
]

const g1: GroupRecord = {
  id: 'g1',
  name: 'daily',
  scope: globalScope,
  enabled: true,
  items: [
    { kind: 'section', name: 's1' },
    { kind: 'skill', name: 'alpha' },
    { kind: 'mcp', name: 'omd' },
  ],
}

const w1: GroupRecord = {
  id: 'w1',
  name: 'repo',
  scope: ws1,
  enabled: true,
  items: [
    { kind: 'skill', name: 'alpha' },
    { kind: 'skill', name: 'beta' },
  ],
}

const customs: CustomPromptRecord[] = [
  { id: 'c1', title: 'one', scope: globalScope, text: '12345678' },
  { id: 'c2', title: 'two', scope: globalScope, text: 'disabled', enabled: false },
]

function makeStore(overrides: Partial<StoreDocument> = {}): StoreDocument {
  return {
    schemaVersion: 1,
    revision: 1,
    workspaces: workspaces.map((w) => ({ id: w.id, trusted: w.trusted })),
    activeGroup: { 'global:': 'g1', 'workspace:ws1': 'w1' },
    groups: [g1, w1],
    customs,
    skills,
    servers,
    ...overrides,
  }
}

test('chainFor only appends a trusted workspace', () => {
  const store = makeStore()
  assert.equal(chainFor(store, globalScope).length, 1)
  assert.equal(chainFor(store, ws1).length, 2)
  assert.equal(chainFor(store, ws2).length, 1)
})

test('workspace definitions shadow global definitions by name', () => {
  const store = makeStore()
  assert.equal(resolvedSkill(store, ws1, 'alpha')?.label, 'Alpha Ws')
  assert.equal(resolvedSkill(store, globalScope, 'alpha')?.label, 'Alpha')
  assert.equal(resolvedServer(store, ws1, 'repo')?.tokens, 12)
  assert.equal(resolvedServer(store, globalScope, 'repo'), undefined)
  assert.deepEqual(
    visibleSkills(store, ws1)
      .map((s) => s.name)
      .sort(),
    ['alpha', 'beta', 'delta', 'gamma'],
  )
})

test('winningLayer resolves each scope, inherits, and honors explicit none', () => {
  const store = makeStore()
  assert.equal(winningLayer(store, globalScope).group?.id, 'g1')
  assert.equal(winningLayer(store, ws1).group?.id, 'w1')

  const inherited = makeStore({ activeGroup: { 'global:': 'g1' } })
  const layer = winningLayer(inherited, ws1)
  assert.equal(layer.group?.id, 'g1')
  assert.equal(layer.sc.kind, 'global')

  const none = makeStore({ activeGroup: { 'global:': 'g1', 'workspace:ws1': '' } })
  const blocked = winningLayer(none, ws1)
  assert.equal(blocked.group, null)
  assert.deepEqual(blocked.customs, [])
})

test('an empty group is still a real winning layer', () => {
  const empty: GroupRecord = { id: 'empty', name: 'empty', scope: ws1, enabled: true, items: [] }
  const store = makeStore({
    groups: [g1, empty],
    activeGroup: { 'workspace:ws1': 'empty' },
  })
  const layer = winningLayer(store, ws1)
  assert.equal(layer.group?.id, 'empty')
  assert.equal(effectiveItems(store, ws1).section.size, 0)
})

test('budget counts context, sections, enabled skills, MCP and enabled customs', () => {
  const result = budget(makeStore(), globalScope, sections)
  assert.equal(result.context, 5)
  assert.equal(result.section, 10)
  assert.equal(result.skill, 4)
  assert.equal(result.mcp, 30)
  assert.equal(result.custom, 1)
  assert.equal(result.total, 50)
  assert.deepEqual(result.counts, { section: 1, mcp: 1, skill: 1, tool: 0 })
})

test('deny and shadow counts use the effective group', () => {
  const store = makeStore()
  assert.equal(denyCount(store, globalScope), 1)
  assert.equal(shadowCount(store, globalScope), 2) // gamma (disabled) + delta are visible but not in g1
})
