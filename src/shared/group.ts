import type { GroupItemRecord } from './types'

/** The minimal shape shared by UI Group and host GroupRecord. */
export interface GroupLike {
  items: GroupItemRecord[]
}

/**
 * Build the GroupRecord sent by group.activate.
 * Keep every other field (id/scope/enabled/name) so activation only replaces the
 * item list; the tool items are the allowlist and need no separate flag.
 */
export function buildActivationGroup<G extends GroupLike>(
  group: G,
  items: GroupItemRecord[],
): G {
  return {
    ...group,
    items: items.map((item) => ({ kind: item.kind, name: item.name })),
  } as G
}

export interface ActivationImpact {
  sections: number
  tools: number
  emptyGroup: boolean
  noSections: boolean
  noTools: boolean
}

/** Describe the destructive effects of activating a group. */
export function activationImpact(group: GroupLike): ActivationImpact {
  const sections = group.items.filter((item) => item.kind === 'section').length
  const tools = group.items.filter((item) => item.kind === 'tool').length
  return {
    sections,
    tools,
    emptyGroup: group.items.length === 0,
    noSections: sections === 0,
    noTools: tools === 0,
  }
}
