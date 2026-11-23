import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { scopePaths } from '../../src/host/paths'
import { CsmmService, ServiceError } from '../../src/host/service'
import { loadSecrets } from '../../src/host/store'
import type { Command, McpServerRecord, SectionRecord, SkillRecord } from '../../src/shared/types'

const wsId = 'ws-1'
const sections: SectionRecord[] = [
  { name: 'section:a', source: 'sys', tokens: 10, kind: 'section', text: 'a' },
  { name: 'working-directory:current', source: 'runtime', tokens: 5, kind: 'context', text: 'cwd' },
]

function makeService(trusted = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-svc-'))
  const global = scopePaths(path.join(root, 'global'))
  const workspace = { id: wsId, paths: scopePaths(path.join(root, 'ws', wsId)) }
  const service = new CsmmService({
    global,
    workspace,
    workspaces: [{ id: wsId, title: 'repo', path: path.join(root, 'repo'), trusted }],
    sections,
  })
  if (trusted) {
    // seed trust through the public command path
    fs.mkdirSync(global.root, { recursive: true })
  }
  return { service, global, workspace, root }
}

const group = {
  id: 'g1',
  name: 'daily',
  scope: { kind: 'global' as const },
  enabled: true,
  items: [{ kind: 'section' as const, name: 'section:a' }],
}

function saveGroup(expectedRevision: number): Command {
  return { type: 'group.save', scope: { kind: 'global' }, group, name: 'daily', expectedRevision }
}

test('snapshot returns a bootstrap with revision and diagnostics', () => {
  const { service } = makeService()
  const snapshot = service.snapshot({ kind: 'global' })
  assert.equal(snapshot.revision, 0)
  assert.deepEqual(snapshot.bootstrap.sections, sections)
  assert.equal(snapshot.bootstrap.copy.appTag, 'CSMM')
  assert.deepEqual(snapshot.diagnostics, [])
})

test('dispatch saves a group, sets it effective, inherits and none', () => {
  const { service } = makeService()
  let snapshot = service.dispatch(saveGroup(0))
  assert.equal(snapshot.revision, 1)
  assert.equal(snapshot.bootstrap.groups[0].id, 'g1')

  snapshot = service.dispatch({
    type: 'group.effective',
    scope: { kind: 'global' },
    groupId: 'g1',
    expectedRevision: 1,
  })
  assert.equal(snapshot.bootstrap.activeGroup['global:'], 'g1')

  snapshot = service.dispatch({ type: 'group.inherit', scope: { kind: 'global' }, expectedRevision: 2 })
  assert.equal('global:' in snapshot.bootstrap.activeGroup, false)

  snapshot = service.dispatch({ type: 'group.none', scope: { kind: 'global' }, expectedRevision: 3 })
  assert.equal(snapshot.bootstrap.activeGroup['global:'], '')
})

test('untrusted workspace snapshot is restricted to global data', () => {
  const { service } = makeService()
  service.dispatch(saveGroup(0))
  const snapshot = service.snapshot({ kind: 'workspace', id: wsId })
  assert.equal(snapshot.bootstrap.groups.length, 1)
  assert.ok(snapshot.diagnostics.some((d) => d.code === 'W_TRUST'))
})

test('trust.set enables workspace overrides and scoped snapshots', () => {
  const { service } = makeService()
  let snapshot = service.dispatch(saveGroup(0))
  snapshot = service.dispatch({
    type: 'trust.set',
    workspaceId: wsId,
    trusted: true,
  })
  assert.equal(snapshot.revision, 2)
  assert.equal(snapshot.bootstrap.workspaces[0].trusted, true)

  const skill: SkillRecord = {
    name: 'alpha',
    label: 'Alpha WS',
    scope: 'workspace',
    wsId,
    bytes: 8,
    model: true,
    user: false,
    desc: 'workspace',
    text: 'workspace text',
  }
  snapshot = service.dispatch({
    type: 'skill.save',
    scope: { kind: 'workspace', id: wsId },
    skill,
    expectedRevision: 2,
  })
  const scoped = service.snapshot({ kind: 'workspace', id: wsId })
  assert.equal(scoped.bootstrap.skills.find((s) => s.name === 'alpha')?.label, 'Alpha WS')
  const global = service.snapshot({ kind: 'global' })
  assert.equal(global.bootstrap.skills.length, 0)
  assert.equal(snapshot.revision, 3)
})

test('secrets are stored separately and never appear in snapshots', () => {
  const { service, global } = makeService()
  const server: McpServerRecord = {
    name: 'gh',
    label: 'GitHub',
    scope: 'global',
    status: 'disconnected',
    transport: 'stdio',
    tokens: 3,
    auth: 'none',
    tools: [],
    instructions: '',
    envKeys: ['TOKEN'],
    headers: { Authorization: 'Bearer secret-header' },
  } as McpServerRecord
  ;(server as unknown as { env: Record<string, string> }).env = { TOKEN: 'super-secret' }
  service.dispatch({
    type: 'mcp.save',
    scope: { kind: 'global' },
    server,
    secrets: { env: { EXTRA: 'extra-secret' } },
    expectedRevision: 0,
  })
  const snapshot = service.snapshot({ kind: 'global' })
  assert.equal(JSON.stringify(snapshot).includes('super-secret'), false)
  assert.equal(JSON.stringify(snapshot).includes('secret-header'), false)
  assert.equal(JSON.stringify(snapshot).includes('extra-secret'), false)
  const stored = JSON.parse(fs.readFileSync(global.store, 'utf8')) as { servers: unknown[] }
  assert.equal(JSON.stringify(stored.servers).includes('super-secret'), false)
  assert.equal(JSON.stringify(stored.servers).includes('secret-header'), false)
  assert.deepEqual(loadSecrets(global).servers.gh.env, { TOKEN: 'super-secret', EXTRA: 'extra-secret' })
  assert.deepEqual(loadSecrets(global).servers.gh.headers, { Authorization: 'Bearer secret-header' })
  const savedServer = snapshot.bootstrap.servers.find((s) => s.name === 'gh')
  assert.deepEqual(savedServer?.envKeys, ['TOKEN'])
  assert.deepEqual(savedServer?.headerKeys, ['Authorization'])
})

test('a stale expectedRevision is rejected', () => {
  const { service } = makeService()
  service.dispatch(saveGroup(0))
  assert.throws(
    () => service.dispatch(saveGroup(0)),
    (error: unknown) => error instanceof ServiceError && error.code === 'E_REVISION',
  )
})

test('workspace writes are rejected until trusted', () => {
  const { service } = makeService()
  assert.throws(
    () =>
      service.dispatch({
        type: 'skill.save',
        scope: { kind: 'workspace', id: wsId },
        skill: {
          name: 'x',
          label: 'x',
          scope: 'workspace',
          wsId,
          bytes: 1,
          model: false,
          user: false,
          desc: '',
          text: 'x',
        },
        expectedRevision: 0,
      }),
    (error: unknown) => error instanceof ServiceError && error.code === 'E_TRUST',
  )
})

test('custom, skill copy and mcp commands persist through dispatch', () => {
  const { service } = makeService()
  let rev = service.dispatch(saveGroup(0)).revision
  rev = service.dispatch({ type: 'trust.set', workspaceId: wsId, trusted: true }).revision

  const custom = {
    id: 'c1',
    title: 'rule',
    scope: { kind: 'global' as const },
    text: 'hello',
  }
  rev = service.dispatch({
    type: 'custom.save',
    scope: { kind: 'global' },
    custom,
    expectedRevision: rev,
  }).revision
  rev = service.dispatch({
    type: 'custom.toggle',
    scope: { kind: 'global' },
    id: 'c1',
    expectedRevision: rev,
  }).revision
  rev = service.dispatch({
    type: 'custom.delete',
    scope: { kind: 'global' },
    id: 'c1',
    expectedRevision: rev,
  }).revision

  const skill: SkillRecord = {
    name: 'alpha',
    label: 'Alpha',
    scope: 'global',
    bytes: 5,
    model: true,
    user: false,
    desc: 'a',
    text: 'alpha',
  }
  rev = service.dispatch({
    type: 'skill.save',
    scope: { kind: 'global' },
    skill,
    expectedRevision: rev,
  }).revision
  rev = service.dispatch({
    type: 'skill.copy',
    from: { kind: 'global' },
    to: { kind: 'workspace', id: wsId },
    names: ['alpha'],
    expectedRevision: rev,
  }).revision

  const server: McpServerRecord = {
    name: 'omd',
    label: 'omd',
    scope: 'global',
    status: 'connected',
    transport: 'stdio',
    tokens: 4,
    auth: 'none',
    tools: [{ name: 't', on: true }],
    instructions: '',
  }
  rev = service.dispatch({
    type: 'mcp.save',
    scope: { kind: 'global' },
    server,
    expectedRevision: rev,
  }).revision
  rev = service.dispatch({
    type: 'mcp.tools',
    scope: { kind: 'global' },
    name: 'omd',
    tools: [{ name: 't', on: false }],
    expectedRevision: rev,
  }).revision
  rev = service.dispatch({
    type: 'mcp.toggle',
    scope: { kind: 'global' },
    name: 'omd',
    expectedRevision: rev,
  }).revision
  rev = service.dispatch({
    type: 'mcp.delete',
    scope: { kind: 'global' },
    name: 'omd',
    expectedRevision: rev,
  }).revision

  const workspace = service.snapshot({ kind: 'workspace', id: wsId })
  assert.equal(workspace.bootstrap.skills.find((s) => s.name === 'alpha')?.label, 'Alpha')
  assert.equal(workspace.bootstrap.servers.length, 0)
  assert.equal(service.snapshot({ kind: 'global' }).bootstrap.customs.length, 0)
})

test('prompt.toggle persists disabled sections per scope', () => {
  const { service } = makeService()
  service.dispatch(saveGroup(0))
  const added = service.dispatch({
    type: 'prompt.toggle',
    scope: { kind: 'global' },
    name: 'tool:grep',
    disabled: true,
    expectedRevision: 1,
  })
  assert.deepEqual(added.bootstrap.disabledPrompts, ['tool:grep'])
  assert.equal(added.revision, 2)
  const removed = service.dispatch({
    type: 'prompt.toggle',
    scope: { kind: 'global' },
    name: 'tool:grep',
    disabled: false,
    expectedRevision: 2,
  })
  assert.deepEqual(removed.bootstrap.disabledPrompts, [])
})
