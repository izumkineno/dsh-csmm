import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  registerAgentPrompts,
  SECTION_NAME,
  type AgentLike,
  type PromptSectionLike,
  type SystemPromptLike,
} from '../../src/host/materialize'
import { globalPaths, workspacePaths } from '../../src/host/paths'
import { emptyStore, saveStore } from '../../src/host/store'
import type { CustomPromptRecord, GroupRecord, StoreDocument } from '../../src/shared/types'

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

function group(id: string, scope: GroupRecord['scope']): GroupRecord {
  return { id, name: id, scope, enabled: true, items: [] }
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
