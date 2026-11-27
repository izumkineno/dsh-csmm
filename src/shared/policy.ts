import type { GroupRecord } from './types'

/**
 * An allowlist that says whether filtering is on at all.
 *
 * The `active` flag is the only source of truth. Callers must never infer
 * "off" from an empty `names` list: an active allowlist with zero names means
 * "allow nothing".
 */
export interface Allowlist {
  active: boolean
  names: string[]
}

function namesOf(names: Iterable<string>): string[] {
  return [...new Set([...names].filter((name) => name.length > 0))]
}

/**
 * Prompt sections are the group's whitelist. No effective group means no
 * filtering; an effective group with no section items means every section is
 * intercepted.
 */
export function sectionAllowlist(group: GroupRecord | null | undefined): Allowlist {
  if (!group) return { active: false, names: [] }
  return {
    active: true,
    names: namesOf(group.items.filter((item) => item.kind === 'section').map((item) => item.name)),
  }
}

/**
 * Tool definitions are the group's whitelist. No effective group means no
 * filtering; an effective group with no tool items denies every tool.
 */
export function toolAllowlist(group: GroupRecord | null | undefined): Allowlist {
  if (!group) return { active: false, names: [] }
  return {
    active: true,
    names: namesOf(
      group.items
        .filter((item) => item.kind === 'tool')
        .map((item) => item.name)
        // `run_code` is reserved by the host and rejects restriction lists.
        .filter((name) => name.length > 0 && name !== 'run_code'),
    ),
  }
}

/** Whether a resource passes the allowlist. Inactive allowlists pass everything. */
export function isAllowed(list: Allowlist, name: string): boolean {
  return !list.active || list.names.includes(name)
}
