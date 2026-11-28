import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canDisableSkillSource,
  resolveSkillPolicy,
  skillRootLabel,
  skillRootPriority,
} from '../../src/shared/skillPolicy'
import type { Scope, SkillPolicyRecord } from '../../src/shared/types'

const workspace: Scope = { kind: 'workspace', id: 'w1' }
const global: Scope = { kind: 'global', id: null }

function record(
  state: 'on' | 'off',
  scope: Scope,
  source = 'user-dsh',
  name = 'alpha',
  cwd?: string,
): SkillPolicyRecord {
  return { name, source, scope, state, ...(cwd ? { cwd } : {}) }
}

test('skill root priority follows the six documented roots', () => {
  assert.deepEqual(
    ['project-dsh', 'project-agents', 'custom', 'user-dsh', 'user-agents', 'bundled'].map(skillRootPriority),
    [1, 2, 3, 4, 5, 6],
  )
  assert.equal(skillRootPriority('runtime'), 99)
  assert.equal(skillRootLabel('project-agents'), '项目 .agents')
  assert.equal(skillRootLabel('unknown'), 'unknown')
})

test('only non-project/non-runtime sources can be disabled', () => {
  assert.equal(canDisableSkillSource('project-dsh'), false)
  assert.equal(canDisableSkillSource('project-agents'), false)
  assert.equal(canDisableSkillSource('runtime'), false)
  assert.equal(canDisableSkillSource('dsh-csmm'), false)
  assert.equal(canDisableSkillSource('dsh-csmm:off'), false)
  assert.equal(canDisableSkillSource('user-dsh'), true)
  assert.equal(canDisableSkillSource('user-agents'), true)
  assert.equal(canDisableSkillSource('custom'), true)
  assert.equal(canDisableSkillSource('bundled'), true)
})

test('workspace override wins over global; absence inherits', () => {
  const records = [record('off', global), record('on', workspace)]
  assert.deepEqual(resolveSkillPolicy(records, workspace, 'E:/repo', 'alpha', 'user-dsh'), {
    state: 'on', from: 'workspace', inherited: false,
  })
  assert.deepEqual(resolveSkillPolicy(records, workspace, 'E:/repo', 'missing', 'user-dsh'), {
    state: 'on', from: 'default', inherited: false,
  })
})

test('global policy is inherited by workspace unless locally overridden', () => {
  const records = [record('off', global)]
  assert.deepEqual(resolveSkillPolicy(records, workspace, 'E:/repo', 'alpha', 'user-dsh'), {
    state: 'off', from: 'global', inherited: true,
  })
  assert.deepEqual(resolveSkillPolicy(records, global, undefined, 'alpha', 'user-dsh'), {
    state: 'off', from: 'global', inherited: false,
  })
  const overridden = [...records, record('on', workspace)]
  assert.equal(resolveSkillPolicy(overridden, workspace, 'E:/repo', 'alpha', 'user-dsh').state, 'on')
})

test('workspace policy is scoped by cwd and source', () => {
  const records = [record('off', workspace, 'user-dsh', 'alpha', 'E:/one')]
  assert.equal(resolveSkillPolicy(records, workspace, 'E:/one', 'alpha', 'user-dsh').state, 'off')
  assert.equal(resolveSkillPolicy(records, workspace, 'E:/two', 'alpha', 'user-dsh').state, 'on')
  assert.equal(resolveSkillPolicy(records, workspace, undefined, 'alpha', 'user-dsh').state, 'on')
  assert.equal(resolveSkillPolicy(records, workspace, 'E:/one', 'alpha', 'bundled').state, 'on')
})
