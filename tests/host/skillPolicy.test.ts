import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { scopePaths } from '../../src/host/paths'
import { CsmmService, ServiceError, type DshSkillDefinition, type DshSkillSummary, type SkillRegistryLike } from '../../src/host/service'
import type { Scope } from '../../src/shared/types'

const wsId = 'ws-1'

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-policy-'))
  const workspaceRoot = path.join(root, 'repo')
  fs.mkdirSync(workspaceRoot, { recursive: true })
  const catalog: DshSkillSummary[] = [
    { name: 'user-skill', description: 'user', source: 'user-dsh', provider: 'test', invocation: { modelInvocable: true, userInvocable: true } },
    { name: 'project-skill', description: 'project', source: 'project-dsh', provider: 'test', invocation: { modelInvocable: true, userInvocable: true } },
    { name: 'bundled-skill', description: 'bundled', source: 'bundled', provider: 'test', invocation: { modelInvocable: true, userInvocable: true } },
  ]
  const registry: SkillRegistryLike = {
    list: async () => catalog,
    get: async (name) => {
      const found = catalog.find((entry) => entry.name === name)
      return found ? { ...found, content: 'BODY' } as DshSkillDefinition : undefined
    },
  }
  const workspace = { id: wsId, paths: scopePaths(path.join(root, 'ws', wsId)) }
  const service = new CsmmService({
    global: scopePaths(path.join(root, 'global')),
    workspace,
    workspaces: [{ id: wsId, title: 'repo', path: workspaceRoot, trusted: true }],
    workspaceRoot,
    registry,
  })
  service.dispatch({ type: 'trust.set', workspaceId: wsId, trusted: true, expectedRevision: 0 })
  return { root, workspaceRoot, catalog, registry, service }
}

const scope: Scope = { kind: 'workspace', id: wsId }

test('DSH catalog exposes root priority and disables only eligible sources', async () => {
  const { service } = makeFixture()
  const result = await service.listDshSkills(scope)
  const byName = new Map(result.skills.map((skill) => [skill.name, skill]))
  assert.equal(byName.get('project-skill')?.rootPriority, 1)
  assert.equal(byName.get('project-skill')?.rootLabel, '项目 .dsh')
  assert.equal(byName.get('project-skill')?.canDisable, false)
  assert.equal(byName.get('user-skill')?.rootPriority, 4)
  assert.equal(byName.get('user-skill')?.canDisable, true)
  assert.equal(byName.get('bundled-skill')?.rootPriority, 6)
  assert.equal(byName.get('user-skill')?.policy, 'on')
  assert.equal(byName.get('user-skill')?.policyFrom, 'default')
})

test('skill.policy persists per scope and getDshSkill returns the disabled body', async () => {
  const { service } = makeFixture()
  const revision = service.snapshot(scope).revision
  service.dispatch({
    type: 'skill.policy',
    scope,
    name: 'user-skill',
    source: 'user-dsh',
    state: 'off',
    cwd: service.snapshot(scope).bootstrap.workspaces.find((workspace) => workspace.id === wsId)?.path,
    expectedRevision: revision,
  })
  const listed = await service.listDshSkills(scope)
  const off = listed.skills.find((skill) => skill.name === 'user-skill')
  assert.equal(off?.policy, 'off')
  assert.equal(off?.disabled, true)
  assert.equal(off?.canDisable, true)

  const detail = await service.getDshSkill('user-skill', scope)
  assert.ok(detail.skill)
  assert.match(detail.skill.content, /已停用/)
  assert.equal(detail.skill.raw, undefined)
  assert.equal(detail.skill.disabled, true)
})

test('getDshSkill still reports the original disabled policy when a runtime shadow hides it', async () => {
  const fixture = makeFixture()
  const revision = fixture.service.snapshot(scope).revision
  fixture.service.dispatch({
    type: 'skill.policy', scope, name: 'user-skill', source: 'user-dsh', state: 'off', expectedRevision: revision,
  })
  fixture.registry.get = async (name) => ({
    name,
    description: '运行时遮蔽',
    source: 'dsh-csmm:off',
    provider: 'dsh-csmm',
    invocation: { modelInvocable: false, userInvocable: false },
    content: '该技能已在当前作用域停用。',
  })
  const detail = await fixture.service.getDshSkill('user-skill', scope)
  assert.ok(detail.skill)
  assert.equal(detail.skill.provider, 'dsh-csmm:policy')
  assert.equal(detail.skill.source, 'user-dsh')
  assert.equal(detail.skill.policy, 'off')
  assert.equal(detail.skill.disabled, true)
  assert.equal(detail.skill.policyFrom, 'workspace')
  assert.match(detail.skill.content, /已停用/)
  assert.equal(detail.skill.raw, undefined)
})

test('workspace inherits a global off policy and a local on override reopens it', async () => {
  const { service } = makeFixture()
  const globalRevision = service.snapshot({ kind: 'global' }).revision
  service.dispatch({
    type: 'skill.policy', scope: { kind: 'global', id: null }, name: 'bundled-skill', source: 'bundled', state: 'off', expectedRevision: globalRevision,
  })
  let listed = await service.listDshSkills(scope)
  let bundled = listed.skills.find((skill) => skill.name === 'bundled-skill')
  assert.equal(bundled?.policy, 'off')
  assert.equal(bundled?.policyFrom, 'global')

  const revision = service.snapshot(scope).revision
  service.dispatch({
    type: 'skill.policy', scope, name: 'bundled-skill', source: 'bundled', state: 'on', expectedRevision: revision,
  })
  listed = await service.listDshSkills(scope)
  bundled = listed.skills.find((skill) => skill.name === 'bundled-skill')
  assert.equal(bundled?.policy, 'on')
  assert.equal(bundled?.policyFrom, 'workspace')
})

test('an off policy whose catalog entry disappeared is synthesized for the UI', async () => {
  const fixture = makeFixture()
  const revision = fixture.service.snapshot(scope).revision
  fixture.service.dispatch({
    type: 'skill.policy', scope, name: 'user-skill', source: 'user-dsh', state: 'off', expectedRevision: revision,
  })
  fixture.catalog.splice(0, fixture.catalog.length, {
    name: 'project-skill', description: 'project', source: 'project-dsh', provider: 'test', invocation: { modelInvocable: true, userInvocable: true },
  })
  const listed = await fixture.service.listDshSkills(scope)
  const synthetic = listed.skills.find((skill) => skill.name === 'user-skill')
  assert.equal(synthetic?.provider, 'dsh-csmm:policy')
  assert.equal(synthetic?.disabled, true)
  assert.equal(synthetic?.rootPriority, 4)

  const detail = await fixture.service.getDshSkill('user-skill', scope)
  assert.ok(detail.skill)
  assert.match(detail.skill.content, /已停用/)
  assert.equal(detail.skill.provider, 'dsh-csmm:policy')
})

test('policy writes reject project and runtime sources', async () => {
  const { service } = makeFixture()
  const revision = service.snapshot(scope).revision
  for (const source of ['project-dsh', 'runtime', 'dsh-csmm:off']) {
    assert.throws(
      () => service.dispatch({
        type: 'skill.policy', scope, name: 'blocked', source, state: 'off', expectedRevision: revision,
      }),
      (error: unknown) => error instanceof ServiceError && error.code === 'E_PAYLOAD',
    )
  }
})

test('project .agents source files are read-only', async () => {
  const fixture = makeFixture()
  const file = path.join(fixture.workspaceRoot, '.agents', 'skills', 'agents-skill', 'SKILL.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '---\nname: agents-skill\n---\n\nBODY', 'utf8')
  fixture.catalog.push({ name: 'agents-skill', description: 'agents', source: 'project-agents', provider: 'test', path: file, invocation: { modelInvocable: true, userInvocable: true } })
  const api = fixture.service as unknown as {
    resolveEditableSource(name: string, scope: Scope): Promise<unknown>
  }
  await assert.rejects(
    () => api.resolveEditableSource('agents-skill', scope),
    (error: unknown) => error instanceof ServiceError && error.code === 'E_SOURCE_READONLY',
  )
})
