import type { Scope, SkillPolicyRecord, SkillPolicyState } from './types'

export const SKILL_ROOT_PRIORITY: Record<string, number> = {
  'project-dsh': 1,
  'project-agents': 2,
  custom: 3,
  'user-dsh': 4,
  'user-agents': 5,
  bundled: 6,
}

export const SKILL_ROOT_LABEL: Record<string, string> = {
  'project-dsh': '项目 .dsh',
  'project-agents': '项目 .agents',
  custom: '自定义目录',
  'user-dsh': '用户 .dsh',
  'user-agents': '用户 .agents',
  bundled: '内置/插件',
}

export function skillRootPriority(source: string): number {
  return SKILL_ROOT_PRIORITY[source] ?? 99
}

export function skillRootLabel(source: string): string {
  return SKILL_ROOT_LABEL[source] ?? source
}

export function isProjectSkillSource(source: string): boolean {
  return source === 'project-dsh' || source === 'project-agents'
}

/** Project skills and the plugin's own runtime layer cannot be toggled here. */
export function canDisableSkillSource(source: string): boolean {
  return !isProjectSkillSource(source) && source !== 'runtime' && !source.startsWith('dsh-csmm')
}

export interface SkillPolicyResolution {
  state: SkillPolicyState
  from: 'workspace' | 'global' | 'default'
  inherited: boolean
}

/**
 * Resolve one DSH skill for the requested scope. Workspace records win over
 * global records; absence means enabled. A workspace record with the same cwd
 * (or no cwd restriction) is the local override.
 */
export function resolveSkillPolicy(
  records: readonly SkillPolicyRecord[] | undefined,
  scope: Scope,
  cwd: string | undefined,
  name: string,
  source: string,
): SkillPolicyResolution {
  const matches = (record: SkillPolicyRecord): boolean =>
    record.name === name && record.source === source
  const localMatch = (record: SkillPolicyRecord): boolean =>
    matches(record) &&
    record.scope.kind === 'workspace' &&
    record.scope.id === scope.id &&
    (!record.cwd || record.cwd === cwd)
  const globalMatch = (record: SkillPolicyRecord): boolean =>
    matches(record) && record.scope.kind === 'global'
  if (scope.kind === 'workspace') {
    const local = (records ?? []).find(localMatch)
    if (local) return { state: local.state, from: 'workspace', inherited: false }
    const global = (records ?? []).find(globalMatch)
    if (global) return { state: global.state, from: 'global', inherited: true }
    return { state: 'on', from: 'default', inherited: false }
  }
  const global = (records ?? []).find(globalMatch)
  if (global) return { state: global.state, from: 'global', inherited: false }
  return { state: 'on', from: 'default', inherited: false }
}
