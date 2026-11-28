import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  registerAgentSkills,
  type AgentLike,
  type SkillCatalogLike,
  type SkillRegistrationLike,
  type SkillsLike,
} from '../../src/host/materialize'
import { globalPaths, workspacePaths } from '../../src/host/paths'
import { emptyStore, saveStore } from '../../src/host/store'
import type { SkillPolicyRecord } from '../../src/shared/types'

const workspace = { id: 'w1', trusted: true }

class FakeSkills implements SkillsLike {
  readonly registered: SkillRegistrationLike[] = []
  catalog: SkillCatalogLike[] = []
  failList = false

  register(skill: SkillRegistrationLike): () => void {
    this.registered.push(skill)
    return () => undefined
  }

  async list(): Promise<SkillCatalogLike[]> {
    if (this.failList) throw new Error('catalog unavailable')
    return this.catalog
  }
}

function fixture(policy: SkillPolicyRecord[], source: string): { agent: AgentLike; skills: FakeSkills; home: string; cwd: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-materialize-home-'))
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-materialize-repo-'))
  const globalDoc = emptyStore()
  globalDoc.workspaces.push(workspace)
  saveStore(globalPaths(home), globalDoc)
  const workspaceDoc = emptyStore()
  workspaceDoc.skillPolicy.push(...policy)
  saveStore(workspacePaths(cwd, workspace.id), workspaceDoc)
  const skills = new FakeSkills()
  skills.catalog = [{ name: 'alpha', source, provider: 'test' }]
  return { agent: { id: 'a1', session: { cwd }, ctx: { skills } }, skills, home, cwd }
}

const options = (fixture: { home: string; cwd: string }) => ({
  home: fixture.home,
  cwd: fixture.cwd,
  workspaceRegistry: { resolveByPath: async () => ({ id: workspace.id }) },
})

test('an off policy registers a non-invocable shadow for the same skill', async () => {
  const fixtureData = fixture([{
    name: 'alpha', source: 'user-dsh', scope: { kind: 'workspace', id: workspace.id }, cwd: 'placeholder', state: 'off',
  }], 'user-dsh')
  // The policy cwd must match the agent cwd; the fixture path is known only after creation.
  const workspaceDoc = emptyStore()
  workspaceDoc.skillPolicy.push({ name: 'alpha', source: 'user-dsh', scope: { kind: 'workspace', id: workspace.id }, cwd: fixtureData.cwd, state: 'off' })
  saveStore(workspacePaths(fixtureData.cwd, workspace.id), workspaceDoc)
  await registerAgentSkills(fixtureData.agent, options(fixtureData))
  assert.equal(fixtureData.skills.registered.length, 1)
  const shadow = fixtureData.skills.registered[0]!
  assert.equal(shadow.name, 'alpha')
  assert.equal(shadow.source, 'dsh-csmm:off')
  assert.deepEqual(shadow.invocation, { modelInvocable: false, userInvocable: false })
})

test('project and dsh-csmm skills are never shadowed', async () => {
  const project = fixture([{
    name: 'alpha', source: 'project-dsh', scope: { kind: 'workspace', id: workspace.id }, state: 'off',
  }], 'project-dsh')
  await registerAgentSkills(project.agent, options(project))
  assert.equal(project.skills.registered.length, 0)

  const runtime = fixture([{
    name: 'alpha', source: 'dsh-csmm', scope: { kind: 'workspace', id: workspace.id }, state: 'off',
  }], 'dsh-csmm')
  await registerAgentSkills(runtime.agent, options(runtime))
  assert.equal(runtime.skills.registered.length, 0)
})

test('without a catalog or when listing fails, no shadow is registered', async () => {
  const fixtureData = fixture([{
    name: 'alpha', source: 'user-dsh', scope: { kind: 'workspace', id: workspace.id }, state: 'off',
  }], 'user-dsh')
  fixtureData.skills.failList = true
  await registerAgentSkills(fixtureData.agent, options(fixtureData))
  assert.equal(fixtureData.skills.registered.length, 0)

  const noList: SkillsLike = { register: () => () => undefined }
  await registerAgentSkills({ session: { cwd: fixtureData.cwd }, ctx: { skills: noList } }, options(fixtureData))
})
