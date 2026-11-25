import type { AppState, Bootstrap, ModalState } from '../contracts'

export function makeInitialState(bootstrap: Bootstrap): AppState {
  return {
    scope: { kind: 'global', id: null },
    active: { kind: 'group', id: 'g1' },
    detail: null,
    tab: 'prompt',
    sel: { skill: null, mcp: null },
    saved: {},
    activeGroup: { ...bootstrap.activeGroup },
    overrides: { skill: {}, mcp: {}, tool: {} },
    groups: bootstrap.groups,
    customs: bootstrap.customs,
    skills: bootstrap.skills,
    servers: bootstrap.servers,
    skillSel: [],
    q: {},
    showPlugin: true,
    skDelConfirm: null,
    mcpDelConfirm: null,
    drafts: {},
    trustDeclined: [],
    modal: null,
    toasts: [],
    disabledPrompts: [...bootstrap.disabledPrompts],
    contextWindow: bootstrap.contextWindow ?? 200_000,
    dshPrompts: [],
    dshPromptsState: 'idle',
    dshPromptsError: null,
    meta: {
      workspaces: bootstrap.workspaces,
      sections: bootstrap.sections,
    },
    copy: bootstrap.copy,
  }
}

// 每次更新构造一份带独立嵌套容器的快照，命令里可以自由改动，React 仍能感知变化。
export function cloneState(prev: AppState): AppState {
  return {
    ...prev,
    meta: prev.meta,
    copy: prev.copy,
    scope: { ...prev.scope },
    active: { ...prev.active },
    detail: prev.detail ? { ...prev.detail } : null,
    sel: { ...prev.sel },
    q: { ...prev.q },
    activeGroup: { ...prev.activeGroup },
    overrides: {
      skill: Object.fromEntries(Object.entries(prev.overrides.skill).map(([k, v]) => [k, { ...v }])),
      mcp: Object.fromEntries(Object.entries(prev.overrides.mcp).map(([k, v]) => [k, { ...v }])),
      tool: Object.fromEntries(
        Object.entries(prev.overrides.tool).map(([k, v]) => [
          k,
          Object.fromEntries(Object.entries(v).map(([j, u]) => [j, { ...u }])),
        ]),
      ),
    },
    saved: { ...prev.saved },
    groups: prev.groups.map((g) => ({ ...g, scope: { ...g.scope }, items: g.items.map((it) => ({ ...it })) })),
    customs: prev.customs.map((c) => ({ ...c, scope: { ...c.scope } })),
    skills: prev.skills.map((s) => ({ ...s })),
    servers: prev.servers.map((s) => ({ ...s, tools: s.tools.map((t) => ({ ...t })) })),
    drafts: Object.fromEntries(
      Object.entries(prev.drafts).map(([k, v]) => [k, Array.isArray(v) ? v.map((it) => ({ ...it })) : { ...v }]),
    ) as AppState['drafts'],
    trustDeclined: [...prev.trustDeclined],
    modal: prev.modal ? ({ ...prev.modal } as ModalState) : null,
    toasts: [...prev.toasts],
    disabledPrompts: [...prev.disabledPrompts],
    contextWindow: prev.contextWindow,
    dshPrompts: prev.dshPrompts.map((p) => ({ ...p })),
  }
}

/** 把宿主读模型合并回视图状态；作用域/选中/弹窗等本地 UI 状态保持不变。 */
export function applyBootstrap(prev: AppState, bootstrap: Bootstrap): AppState {
  return {
    ...prev,
    groups: bootstrap.groups,
    customs: bootstrap.customs,
    skills: bootstrap.skills,
    servers: bootstrap.servers,
    activeGroup: { ...bootstrap.activeGroup },
    copy: bootstrap.copy,
    disabledPrompts: [...bootstrap.disabledPrompts],
    contextWindow: bootstrap.contextWindow ?? prev.contextWindow,
    meta: { workspaces: bootstrap.workspaces, sections: bootstrap.sections },
  }
}

