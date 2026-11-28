import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { scopePaths } from '../../src/host/paths'
import { CsmmService, ServiceError, type DshSkillSummary, type SkillRegistryLike } from '../../src/host/service'
import { loadSecrets } from '../../src/host/store'
import type { Command, McpServerRecord, SectionRecord, SkillRecord } from '../../src/shared/types'

const wsId = 'ws-1'
const sections: SectionRecord[] = [
  { name: 'section:a', source: 'sys', tokens: 10, kind: 'section', text: 'a' },
  { name: 'working-directory:current', source: 'runtime', tokens: 5, kind: 'context', text: 'cwd' },
]

function makeService(
  trusted = false,
  extra: { contextWindow?: () => number | undefined; registry?: SkillRegistryLike } = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-svc-'))
  const global = scopePaths(path.join(root, 'global'))
  const workspaceRoot = path.join(root, 'repo')
  const workspace = { id: wsId, paths: scopePaths(path.join(root, 'ws', wsId)) }
  const service = new CsmmService({
    global,
    workspace,
    workspaces: [{ id: wsId, title: 'repo', path: workspaceRoot, trusted }],
    workspaceRoot,
    sections,
    ...extra,
  })
  if (trusted) {
    // seed trust through the public command path
    fs.mkdirSync(global.root, { recursive: true })
  }
  return { service, global, workspace, root, workspaceRoot }
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

test('group.activate persists the draft items and makes the group effective', () => {
  const { service } = makeService()
  const snapshot = service.dispatch({
    type: 'group.activate',
    scope: { kind: 'global' },
    group,
    name: 'daily',
    expectedRevision: 0,
  })
  assert.equal(snapshot.bootstrap.activeGroup['global:'], 'g1')
  assert.deepEqual(snapshot.bootstrap.groups[0].items, group.items)
})

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

test('snapshot exposes the context window from the host provider', () => {
  const { service } = makeService(false, { contextWindow: () => 1_000_000 })
  assert.equal(service.snapshot({ kind: 'global' }).bootstrap.contextWindow, 1_000_000)
})

const registrySkills: DshSkillSummary[] = [
  {
    name: 'global-one',
    description: '全局技能',
    whenToUse: '需要全局能力时',
    source: 'user-dsh',
    provider: 'filesystem',
    path: '/skills/global-one/SKILL.md',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    name: 'ws-one',
    description: '项目技能',
    source: 'project-dsh',
    provider: 'filesystem',
    invocation: { modelInvocable: false, userInvocable: true },
  },
]

function fakeRegistry(
  calls: Array<{ cwd?: string }>,
  gets: Array<{ name: string; cwd?: string }> = [],
): SkillRegistryLike {
  return {
    list: async (options) => {
      calls.push(options)
      return options.cwd ? registrySkills : registrySkills.filter((s) => !s.source.startsWith('project-'))
    },
    get: async (name, options) => {
      gets.push({ name, ...options })
      const pool = options.cwd ? registrySkills : registrySkills.filter((s) => !s.source.startsWith('project-'))
      const found = pool.find((s) => s.name === name)
      return found ? { ...found, content: '正文：' + name } : undefined
    },
  }
}

test('getDshSkill loads one body for the resolved scope', async () => {
  const calls: Array<{ cwd?: string }> = []
  const gets: Array<{ name: string; cwd?: string }> = []
  const { service, workspaceRoot } = makeService(false, { registry: fakeRegistry(calls, gets) })

  const untrusted = await service.getDshSkill('ws-one', { kind: 'workspace', id: wsId })
  assert.equal(untrusted.skill, undefined)
  assert.deepEqual(untrusted.errors, ['技能不存在或当前作用域不可见'])
  assert.equal(untrusted.restricted, true)
  assert.deepEqual(gets[0], { name: 'ws-one' })

  service.dispatch({ type: 'trust.set', workspaceId: wsId, trusted: true })
  const trusted = await service.getDshSkill('ws-one', { kind: 'workspace', id: wsId })
  assert.equal(trusted.skill?.content, '正文：ws-one')
  assert.equal(trusted.skill?.origin, 'workspace')
  assert.equal(trusted.restricted, undefined)
  assert.deepEqual(gets[1], { name: 'ws-one', cwd: workspaceRoot })

  const missing = await service.getDshSkill('missing')
  assert.equal(missing.skill, undefined)
  assert.deepEqual(missing.errors, ['技能不存在或当前作用域不可见'])
  assert.deepEqual(gets[2], { name: 'missing' })
})

test('listDshSkills reads the registry and passes cwd only for a trusted workspace', async () => {
  const calls: Array<{ cwd?: string }> = []
  const { service, workspaceRoot } = makeService(false, { registry: fakeRegistry(calls) })

  const untrusted = await service.listDshSkills({ kind: 'workspace', id: wsId })
  assert.deepEqual(untrusted.skills.map((s) => s.name), ['global-one'])
  assert.equal(untrusted.restricted, true)
  assert.deepEqual(calls[0], {})

  service.dispatch({ type: 'trust.set', workspaceId: wsId, trusted: true })
  const trusted = await service.listDshSkills({ kind: 'workspace', id: wsId })
  assert.deepEqual(trusted.skills.map((s) => s.name), ['global-one', 'ws-one'])
  assert.equal(trusted.restricted, undefined)
  assert.deepEqual(calls[1], { cwd: workspaceRoot })

  const projected = trusted.skills[1]
  assert.equal(projected.description, '项目技能')
  assert.equal(projected.origin, 'workspace')
  assert.equal(projected.model, false)
  assert.equal(projected.user, true)
  assert.equal(projected.path, undefined)

  const withExtras = trusted.skills[0]
  assert.equal(withExtras.origin, 'global')
  assert.equal(withExtras.whenToUse, '需要全局能力时')
  assert.equal(withExtras.path, '/skills/global-one/SKILL.md')

  const globalOnly = await service.listDshSkills()
  assert.deepEqual(globalOnly.skills.map((s) => s.name), ['global-one'])
  assert.deepEqual(calls[2], {})
})

test('listDshSkills is read-only and reports a missing registry without writing', async () => {
  const { service, global } = makeService()
  const before = fs.existsSync(global.store)
  const catalog = await service.listDshSkills()
  assert.equal(before, fs.existsSync(global.store))
  assert.deepEqual(catalog.skills, [])
  assert.deepEqual(catalog.errors, ['宿主未提供技能注册表'])

  const failing = new CsmmService({
    global,
    registry: {
      list: async () => { throw new Error('registry down') },
      get: async () => { throw new Error('registry down') },
    },
  })
  const failed = await failing.listDshSkills()
  assert.deepEqual(failed.skills, [])
  assert.deepEqual(failed.errors, ['读取 DSH 技能失败：registry down'])
  const failedDetail = await failing.getDshSkill('global-one')
  assert.deepEqual(failedDetail.errors, ['读取 DSH 技能失败：registry down'])
})

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function oneSkillRegistry(name: string, source: string, path?: string): SkillRegistryLike {
  const summary: DshSkillSummary = {
    name,
    description: name + ' desc',
    source,
    provider: 'test',
    path,
    invocation: { modelInvocable: true, userInvocable: true },
  }
  return {
    list: async () => [summary],
    get: async () => ({ ...summary, content: '# ' + name }),
  }
}

test('getDshSkill reads a trusted workspace source and hashes the file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-src-'))
  fs.mkdirSync(root, { recursive: true })
  const file = path.join(root, 'SKILL.md')
  const raw = '---\nname: ws-file\n---\n\n# 正文\n'
  fs.writeFileSync(file, raw, 'utf8')
  const { service, workspaceRoot } = makeService(false, { registry: oneSkillRegistry('ws-file', 'project-dsh', file) })
  fs.mkdirSync(workspaceRoot, { recursive: true })
  service.dispatch({ type: 'trust.set', workspaceId: wsId, trusted: true })
  const trusted = await service.getDshSkill('ws-file', { kind: 'workspace', id: wsId })
  assert.equal(trusted.errors.length, 0)
  assert.equal(trusted.skill?.content, '# ws-file')
  assert.equal(trusted.skill?.raw, raw)
  assert.equal(trusted.skill?.sha256, sha(raw))
  assert.equal(trusted.skill?.origin, 'workspace')
})

test('getDshSkill does not read a source outside a trusted workspace', async () => {
  const { service } = makeService(false, { registry: oneSkillRegistry('global-one', 'user-dsh', '/skills/global-one/SKILL.md') })
  const view = service as unknown as { readSkillFile: (file: string) => Promise<unknown> }
  let reads = 0
  view.readSkillFile = async () => {
    reads++
    throw new Error('must not read')
  }

  const detail = await service.getDshSkill('global-one', { kind: 'workspace', id: wsId })
  assert.equal(reads, 0)
  assert.equal(detail.restricted, true)
  assert.equal(detail.skill?.raw, undefined)
  assert.equal(detail.skill?.sha256, sha('# global-one'))
  assert.deepEqual(detail.errors, [])
})

test('getDshSkill falls back to the content hash when a source is unreadable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-bad-'))
  const big = path.join(root, 'big.md')
  fs.writeFileSync(big, 'x'.repeat(800001), 'utf8')
  const raw = path.join(root, 'raw.md')
  fs.writeFileSync(raw, Buffer.from([0xff]))
  const registry: SkillRegistryLike = {
    list: async () => [],
    get: async (name) => ({
      name,
      description: name,
      source: 'user-dsh',
      provider: 'test',
      path: name === 'big' ? big : raw,
      invocation: { modelInvocable: true, userInvocable: true },
      content: '#' + name,
    }),
  }
  const { service } = makeService(false, { registry })

  const oversized = await service.getDshSkill('big')
  assert.equal(oversized.skill?.raw, undefined)
  assert.match(oversized.errors.join('\n'), /超过 800000 字节/)

  const invalid = await service.getDshSkill('invalid')
  assert.equal(invalid.skill?.raw, undefined)
  assert.match(invalid.errors.join('\n'), /UTF-8/)
})

test('normalizeSkill recalculates bytes and keeps a trimmed whenToUse', () => {
  const { service } = makeService()
  const rev = service.dispatch(saveGroup(0)).revision
  const saved = service.dispatch({
    type: 'skill.save',
    scope: { kind: 'global' },
    skill: {
      name: 'A B',
      label: 'ab',
      scope: 'global',
      bytes: 1,
      model: false,
      user: false,
      desc: '',
      text: '技能',
      whenToUse: '  when needed  ',
    },
    expectedRevision: rev,
  })
  const skill = saved.bootstrap.skills.find((s) => s.name === 'a-b')
  assert.equal(skill?.bytes, 6)
  assert.equal(skill?.whenToUse, 'when needed')
  assert.equal(skill?.model, false)
})

test('resolveEditableSource rejects read-only, escaping and non-SKILL paths', async () => {
  const { global, workspace, workspaceRoot } = makeService()
  fs.mkdirSync(workspaceRoot, { recursive: true })
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-out-'))
  const outsideFile = path.join(outside, 'SKILL.md')
  fs.writeFileSync(outsideFile, 'outside', 'utf8')
  const notes = path.join(workspaceRoot, 'notes.md')
  fs.writeFileSync(notes, 'notes', 'utf8')
  const good = path.join(workspaceRoot, '.dsh', 'skills', 'good', 'SKILL.md')
  fs.mkdirSync(path.dirname(good), { recursive: true })
  fs.writeFileSync(good, '---\nname: good\n---\n\nBODY', 'utf8')
  const paths: Record<string, string> = { global: good, outside: outsideFile, notes, good }
  const registry: SkillRegistryLike = {
    list: async () => [],
    get: async (name) => ({
      name,
      description: name,
      source: name === 'global' ? 'user-dsh' : 'project-dsh',
      provider: 'test',
      path: paths[name],
      invocation: { modelInvocable: true, userInvocable: true },
      content: '#' + name,
    }),
  }
  const scoped = new CsmmService({
    global,
    workspace,
    workspaces: [{ id: wsId, title: 'repo', path: workspaceRoot, trusted: true }],
    workspaceRoot,
    registry,
  })
  const api = scoped as unknown as {
    resolveEditableSource(name: string, scope: { kind: 'workspace'; id: string }): Promise<{
      path: string
      raw: string
      buffer: Buffer
      sha256: string
      mode: number
      bytes: number
    }>
  }
  scoped.dispatch({ type: 'trust.set', workspaceId: wsId, trusted: true })
  const scope = { kind: 'workspace' as const, id: wsId }
  await assert.rejects(() => api.resolveEditableSource('global', scope), (e: unknown) => e instanceof ServiceError && e.code === 'E_SOURCE_READONLY')
  await assert.rejects(() => api.resolveEditableSource('outside', scope), (e: unknown) => e instanceof ServiceError && e.code === 'E_PATH_ESCAPE')
  await assert.rejects(() => api.resolveEditableSource('notes', scope), (e: unknown) => e instanceof ServiceError && e.code === 'E_SOURCE_MISSING')
  const target = await api.resolveEditableSource('good', scope)
  assert.equal(target.path, good)
  assert.equal(target.raw, '---\nname: good\n---\n\nBODY')
  assert.equal(target.buffer.toString('utf8'), target.raw)
  assert.equal(target.sha256, sha(target.raw))
  assert.equal(target.bytes, Buffer.byteLength(target.raw, 'utf8'))

  const untrusted = makeService(false, { registry })
  const untrustedApi = untrusted.service as unknown as {
    resolveEditableSource(name: string, scope: { kind: 'workspace'; id: string }): Promise<unknown>
  }
  await assert.rejects(
    () => untrustedApi.resolveEditableSource('good', scope),
    (e: unknown) => e instanceof ServiceError && e.code === 'E_WORKSPACE_UNTRUSTED',
  )
})

function saveFixture(initial = '---\nname: edit\n---\n\nOLD') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-save-'))
  const file = path.join(root, '.dsh', 'skills', 'edit', 'SKILL.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, initial, 'utf8')
  const registry: SkillRegistryLike = {
    list: async () => [],
    get: async (name) => name === 'edit'
      ? {
          name: 'edit',
          description: 'edit',
          source: 'project-dsh',
          provider: 'test',
          path: file,
          invocation: { modelInvocable: true, userInvocable: true },
          content: 'OLD',
        }
      : undefined,
  }
  const workspace = { id: wsId, paths: scopePaths(path.join(root, '.dsh', wsId)) }
  const service = new CsmmService({
    global: scopePaths(path.join(root, 'global')),
    workspace,
    workspaces: [{ id: wsId, title: 'repo', path: root, trusted: true }],
    workspaceRoot: root,
    registry,
  })
  service.dispatch({ type: 'trust.set', workspaceId: wsId, trusted: true })
  return { root, file, workspace, service, initial }
}

test('saveDshSkillSource writes atomically, backs up old bytes and prunes to 20', async () => {
  const fixture = saveFixture()
  const backupDir = path.join(fixture.workspace.paths.root, 'skill-backups')
  fs.mkdirSync(backupDir, { recursive: true })
  for (let i = 0; i < 25; i += 1) fs.writeFileSync(path.join(backupDir, `edit-${i}.md`), 'old-' + i)
  const next = '---\nname: edit\n---\n\nNEW'
  const saved = await fixture.service.saveDshSkillSource(
    'edit',
    { kind: 'workspace', id: wsId },
    next,
    sha(fixture.initial),
  )
  assert.equal(saved.path, fixture.file)
  assert.equal(saved.sha256, sha(next))
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), next)
  const backups = fs.readdirSync(backupDir)
  assert.equal(backups.length, 20)
  assert.ok(backups.some((name) => fs.readFileSync(path.join(backupDir, name), 'utf8') === fixture.initial))
})

test('saveDshSkillSource rejects a stale expectedSha256 without writing', async () => {
  const fixture = saveFixture()
  await assert.rejects(
    () => fixture.service.saveDshSkillSource(
      'edit',
      { kind: 'workspace', id: wsId },
      'REPLACED',
      '0'.repeat(64),
    ),
    (e: unknown) => e instanceof ServiceError && e.code === 'E_SKILL_CONFLICT',
  )
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), fixture.initial)
  assert.equal(fs.existsSync(path.join(fixture.workspace.paths.root, 'skill-backups')), false)
})

test('saveDshSkillSource is idempotent and validates payloads', async () => {
  const fixture = saveFixture()
  const expected = sha(fixture.initial)
  const same = await fixture.service.saveDshSkillSource('edit', { kind: 'workspace', id: wsId }, fixture.initial, expected)
  assert.equal(same.sha256, expected)
  assert.equal(fs.existsSync(path.join(fixture.workspace.paths.root, 'skill-backups')), false)

  await assert.rejects(
    () => fixture.service.saveDshSkillSource('edit', { kind: 'workspace', id: wsId }, fixture.initial, 'nope'),
    (e: unknown) => e instanceof ServiceError && e.code === 'E_PAYLOAD',
  )
  await assert.rejects(
    () => fixture.service.saveDshSkillSource('edit', { kind: 'workspace', id: wsId }, '   ', expected),
    (e: unknown) => e instanceof ServiceError && e.code === 'E_PAYLOAD',
  )
  await assert.rejects(
    () => fixture.service.saveDshSkillSource('edit', { kind: 'workspace', id: wsId }, 'x'.repeat(800001), expected),
    (e: unknown) => e instanceof ServiceError && e.code === 'E_SKILL_TOO_LARGE',
  )
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), fixture.initial)
})

test('saveDshSkillSource holds the workspace file lock', async () => {
  const fixture = saveFixture()
  fs.mkdirSync(fixture.workspace.paths.root, { recursive: true })
  const lock = path.join(fixture.workspace.paths.root, 'skill-source.lock')
  fs.writeFileSync(lock, 'held')
  await assert.rejects(
    () => fixture.service.saveDshSkillSource('edit', { kind: 'workspace', id: wsId }, 'BLOCKED', sha(fixture.initial)),
    (e: unknown) => e instanceof ServiceError && e.code === 'E_LOCKED',
  )
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), fixture.initial)
})
