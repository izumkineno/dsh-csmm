import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  registerAgentPrompts,
  registerAgentPromptFilter,
  registerAgentSkills,
  registerAgentTools,
  SECTION_NAME,
  type AgentLike,
  type PromptSectionLike,
  type SkillRegistrationLike,
  type SkillsLike,
  type SystemPromptLike,
} from '../../src/host/materialize'
import { globalPaths, workspacePaths } from '../../src/host/paths'
import { emptyStore, saveStore } from '../../src/host/store'
import type { CustomPromptRecord, GroupItemRecord, GroupRecord, SkillRecord, StoreDocument } from '../../src/shared/types'

class FakeSkills implements SkillsLike {
  readonly registered: SkillRegistrationLike[] = []
  register(skill: SkillRegistrationLike): () => void {
    this.registered.push(skill)
    return () => {
      const index = this.registered.indexOf(skill)
      if (index >= 0) this.registered.splice(index, 1)
    }
  }
}

class FakeSystemPrompt implements SystemPromptLike {
  readonly sections: PromptSectionLike[] = []
  section(section: PromptSectionLike): () => void {
    this.sections.push(section)
    return () => {
      const index = this.sections.indexOf(section)
      if (index >= 0) this.sections.splice(index, 1)
    }
  }
  getSectionOrder(): number {
    return 100
  }
}

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function group(id: string, scope: GroupRecord['scope'], items: GroupItemRecord[] = []): GroupRecord {
  return { id, name: id, scope, enabled: true, items }
}

function skill(name: string, scope: SkillRecord['scope'], text: string, overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    name,
    label: name,
    scope,
    bytes: text.length,
    model: true,
    user: true,
    desc: `${name} desc`,
    text,
    ...overrides,
  }
}

function custom(id: string, text: string, scope: CustomPromptRecord['scope']): CustomPromptRecord {
  return { id, title: id, scope, text }
}

function globalStore(customs: CustomPromptRecord[], trusted = true): StoreDocument {
  const doc = emptyStore()
  doc.groups.push(group('g-global', { kind: 'global' }))
  doc.activeGroup['global:'] = 'g-global'
  doc.customs.push(...customs)
  doc.workspaces.push({ id: 'w1', trusted })
  return doc
}

function workspaceStore(customs: CustomPromptRecord[]): StoreDocument {
  const doc = emptyStore()
  doc.groups.push(group('g-ws', { kind: 'workspace', id: 'w1' }))
  doc.activeGroup['workspace:w1'] = 'g-ws'
  doc.customs.push(...customs)
  return doc
}

function textOf(prompt: FakeSystemPrompt): string {
  assert.equal(prompt.sections.length, 1)
  const section = prompt.sections[0]!
  assert.equal(section.name, SECTION_NAME)
  return typeof section.text === 'function' ? section.text({}) : section.text
}

function agentAt(cwd: string, prompt: FakeSystemPrompt): AgentLike {
  return { id: 'a1', session: { cwd }, ctx: { systemPrompt: prompt } }
}

test('global customs are materialized for an agent without a workspace', async () => {
  const home = tempDir('dsh-csmm-mat-')
  saveStore(globalPaths(home), globalStore([custom('c1', 'MARKER-ALPHA', { kind: 'global' })]))

  const prompt = new FakeSystemPrompt()
  const agent = agentAt(tempDir('dsh-csmm-cwd-'), prompt)
  const dispose = await registerAgentPrompts(agent, { home })

  assert.equal(typeof dispose, 'function')
  assert.match(textOf(prompt), /MARKER-ALPHA/)
  dispose?.()
  assert.equal(prompt.sections.length, 0)
})

test('trusted workspace uses its own effective group', async () => {
  const home = tempDir('dsh-csmm-mat-')
  const root = tempDir('dsh-csmm-cwd-')
  saveStore(globalPaths(home), globalStore([custom('c1', 'MARKER-GLOBAL', { kind: 'global' })]))
  saveStore(workspacePaths(root, 'w1'), workspaceStore([custom('c2', 'MARKER-WORKSPACE', { kind: 'workspace', id: 'w1' })]))

  const prompt = new FakeSystemPrompt()
  const agent = agentAt(root, prompt)
  await registerAgentPrompts(agent, {
    home,
    workspaceRegistry: { resolveByPath: async () => ({ id: 'w1' }) },
  })

  const text = textOf(prompt)
  assert.match(text, /MARKER-WORKSPACE/)
  assert.doesNotMatch(text, /MARKER-GLOBAL/)
})

test('untrusted workspace falls back to global content', async () => {
  const home = tempDir('dsh-csmm-mat-')
  const root = tempDir('dsh-csmm-cwd-')
  saveStore(globalPaths(home), globalStore([custom('c1', 'MARKER-GLOBAL', { kind: 'global' })], false))
  saveStore(workspacePaths(root, 'w1'), workspaceStore([custom('c2', 'MARKER-WORKSPACE', { kind: 'workspace', id: 'w1' })]))

  const prompt = new FakeSystemPrompt()
  await registerAgentPrompts(agentAt(root, prompt), {
    home,
    workspaceRegistry: { resolveByPath: async () => ({ id: 'w1' }) },
  })

  const text = textOf(prompt)
  assert.match(text, /MARKER-GLOBAL/)
  assert.doesNotMatch(text, /MARKER-WORKSPACE/)
})

test('missing effective group produces empty text', async () => {
  const home = tempDir('dsh-csmm-mat-')
  const doc = globalStore([custom('c1', 'MARKER-GLOBAL', { kind: 'global' })])
  doc.activeGroup = {}
  saveStore(globalPaths(home), doc)

  const prompt = new FakeSystemPrompt()
  await registerAgentPrompts(agentAt(tempDir('dsh-csmm-cwd-'), prompt), { home })

  assert.equal(textOf(prompt), '')
})

test('enabled prompt-section items render their body', async () => {
  const home = tempDir('dsh-csmm-mat-')
  const sectionDir = path.join(globalPaths(home).root, 'sections')
  fs.mkdirSync(sectionDir, { recursive: true })
  fs.writeFileSync(path.join(sectionDir, 'core.md'), 'SECTION-BODY-MARKER\n')
  const doc = globalStore([])
  doc.groups[0]!.items.push({ kind: 'section', name: 'core' })
  saveStore(globalPaths(home), doc)

  const prompt = new FakeSystemPrompt()
  await registerAgentPrompts(agentAt(tempDir('dsh-csmm-cwd-'), prompt), { home })

  const text = textOf(prompt)
  assert.match(text, /#### core/)
  assert.match(text, /SECTION-BODY-MARKER/)
})

test('effective skills are registered with their content and invocation flags', async () => {
  const home = tempDir('dsh-csmm-mat-')
  const doc = globalStore([])
  doc.skills.push(skill('alpha', 'global', 'SKILL-BODY-ALPHA', { model: true, user: false }))
  doc.groups[0]!.items.push({ kind: 'skill', name: 'alpha' })
  saveStore(globalPaths(home), doc)

  const skills = new FakeSkills()
  const agent = agentAt(tempDir('dsh-csmm-cwd-'), new FakeSystemPrompt())
  agent.ctx = { ...agent.ctx, skills }
  const dispose = await registerAgentSkills(agent, { home })

  assert.equal(skills.registered.length, 1)
  const registered = skills.registered[0]!
  assert.equal(registered.name, 'alpha')
  assert.equal(registered.content, 'SKILL-BODY-ALPHA')
  assert.deepEqual(registered.invocation, { modelInvocable: true, userInvocable: false })
  dispose?.()
  assert.equal(skills.registered.length, 0)
})

test('workspace skill definition shadows the global one for that agent', async () => {
  const home = tempDir('dsh-csmm-mat-')
  const root = tempDir('dsh-csmm-cwd-')
  const globalDoc = globalStore([])
  globalDoc.skills.push(skill('alpha', 'global', 'SKILL-BODY-GLOBAL'))
  saveStore(globalPaths(home), globalDoc)

  const workspaceDoc = workspaceStore([])
  workspaceDoc.skills.push(skill('alpha', 'workspace', 'SKILL-BODY-WORKSPACE', { wsId: 'w1' }))
  workspaceDoc.groups[0]!.items.push({ kind: 'skill', name: 'alpha' })
  saveStore(workspacePaths(root, 'w1'), workspaceDoc)

  const skills = new FakeSkills()
  const agent = agentAt(root, new FakeSystemPrompt())
  agent.ctx = { ...agent.ctx, skills }
  await registerAgentSkills(agent, {
    home,
    workspaceRegistry: { resolveByPath: async () => ({ id: 'w1' }) },
  })

  assert.equal(skills.registered.length, 1)
  assert.equal(skills.registered[0]!.content, 'SKILL-BODY-WORKSPACE')
})

test('disabled prompt sections are filtered per agent', async () => {
  const home = tempDir('csmm-filter-')
  const doc = globalStore([], true)
  doc.groups[0].items = [{ kind: 'section', name: 'harness:identity' }]
  doc.disabledPrompts = ['tool:grep', 'plan:policy']
  saveStore(globalPaths(home), doc)

  let listener: ((assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>) | undefined
  const agent: AgentLike = {
    id: 'a1',
    ctx: {
      on: (_event: string, fn: (...args: any[]) => unknown) => {
        listener = fn as typeof listener
        return () => {}
      },
    },
  }
  const dispose = await registerAgentPromptFilter(agent, { home, cwd: 'E:/repo' })
  assert.equal(typeof dispose, 'function')
  assert.ok(listener)
  const current = {
    sections: [
      { name: 'harness:identity', text: 'i' },
      { name: 'tool:grep', text: 'g' },
      { name: 'plan:policy', text: 'p' },
      { name: 'dsh-csmm:prompts', text: 'x' },
    ],
    contexts: [{ name: 'working-directory:current', text: 'c' }],
  }
  const filtered = await listener!({}, {}, async () => current) as typeof current
  assert.deepEqual(filtered.sections.map((s) => s.name), ['harness:identity', 'dsh-csmm:prompts'])
  assert.deepEqual(filtered.contexts, current.contexts)
})

test('a group that selects DSH sections acts as an allowlist', async () => {
  const home = tempDir('csmm-allow-')
  const doc = globalStore([], true)
  doc.groups[0].items = [
    { kind: 'section', name: 'harness:identity' },
    { kind: 'custom', name: 'x' } as unknown as GroupItemRecord,
  ]
  saveStore(globalPaths(home), doc)

  let listener: ((assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>) | undefined
  const agent: AgentLike = {
    id: 'a2',
    ctx: {
      on: (_event: string, fn: (...args: any[]) => unknown) => {
        listener = fn as typeof listener
        return () => {}
      },
    },
  }
  await registerAgentPromptFilter(agent, { home, cwd: 'E:/repo' })
  const current = {
    sections: [
      { name: 'harness:identity', text: 'i' },
      { name: 'plan:policy', text: 'p' },
      { name: 'team:policy', text: 't' },
      { name: 'dsh-csmm:prompts', text: 'x' },
    ],
    contexts: [{ name: 'working-directory:current', text: 'c' }],
  }
  const filtered = await listener!({}, {}, async () => current) as typeof current
  assert.deepEqual(filtered.sections.map((s) => s.name), ['harness:identity', 'dsh-csmm:prompts'])
})

test('an empty group blocks every prompt section', async () => {
  const home = tempDir('csmm-empty-')
  saveStore(globalPaths(home), globalStore([], true))

  let listener: ((assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>) | undefined
  const agent: AgentLike = {
    id: 'a3',
    ctx: {
      on: (_event: string, fn: (...args: any[]) => unknown) => {
        listener = fn as typeof listener
        return () => {}
      },
    },
  }
  await registerAgentPromptFilter(agent, { home, cwd: 'E:/repo' })
  const current = {
    sections: [
      { name: 'harness:identity', text: 'i' },
      { name: 'plan:policy', text: 'p' },
      { name: 'dsh-csmm:prompts', text: 'x' },
    ],
    contexts: [{ name: 'working-directory:current', text: 'c' }],
  }
  const filtered = await listener!({}, {}, async () => current) as typeof current
  assert.deepEqual(filtered.sections.map((s) => s.name), ['dsh-csmm:prompts'])
  assert.deepEqual(filtered.contexts, current.contexts)
})

test('tool items restrict the agent tool set to the selected allowlist', async () => {
  const home = tempDir('csmm-tools-')
  const doc = globalStore([], true)
  doc.groups[0].toolsMode = 'allow'
  doc.groups[0].items = [
    { kind: 'tool', name: 'grep' },
    { kind: 'tool', name: 'run_code' },
  ]
  saveStore(globalPaths(home), doc)

  const calls: Array<{ allow?: string[]; deny?: string[] }> = []
  const agent = agentAt(tempDir('csmm-cwd-'), new FakeSystemPrompt())
  agent.ctx = {
    ...agent.ctx,
    tools: { restrict: (filter) => { calls.push(filter); return () => undefined } },
  }
  const dispose = await registerAgentTools(agent, { home })
  assert.deepEqual(calls, [{ allow: ['grep'] }])
  assert.equal(typeof dispose, 'function')
})

test('a group without tool items does not restrict tools', async () => {
  const home = tempDir('csmm-tools-')
  saveStore(globalPaths(home), globalStore([]))

  const calls: unknown[] = []
  const agent = agentAt(tempDir('csmm-cwd-'), new FakeSystemPrompt())
  agent.ctx = {
    ...agent.ctx,
    tools: { restrict: (filter) => { calls.push(filter); return () => undefined } },
  }
  await registerAgentTools(agent, { home })
  assert.deepEqual(calls, [])
})

test('allow mode with no tool items denies every tool', async () => {
  const home = tempDir('csmm-tools-')
  const doc = globalStore([], true)
  doc.groups[0].toolsMode = 'allow'
  doc.groups[0].items = []
  saveStore(globalPaths(home), doc)

  const calls: Array<{ allow?: string[] }> = []
  const agent = agentAt(tempDir('csmm-cwd-'), new FakeSystemPrompt())
  agent.ctx = {
    ...agent.ctx,
    tools: { restrict: (filter) => { calls.push(filter); return () => undefined } },
  }
  await registerAgentTools(agent, { home })
  assert.deepEqual(calls, [{ allow: [] }])
})

test('a rejected allowlist falls back to denying every tool', async () => {
  const home = tempDir('csmm-tools-')
  const doc = globalStore([], true)
  doc.groups[0].toolsMode = 'allow'
  doc.groups[0].items = [{ kind: 'tool', name: 'stale-tool' }]
  saveStore(globalPaths(home), doc)

  const calls: Array<{ allow?: string[] }> = []
  const agent = agentAt(tempDir('csmm-cwd-'), new FakeSystemPrompt())
  agent.ctx = {
    ...agent.ctx,
    tools: {
      restrict: (filter) => {
        calls.push(filter)
        if ((filter.allow ?? []).length > 0) throw new Error('unknown tool')
        return () => undefined
      },
    },
  }
  const dispose = await registerAgentTools(agent, { home })
  assert.deepEqual(calls, [{ allow: ['stale-tool'] }, { allow: [] }])
  assert.equal(typeof dispose, 'function')
})
