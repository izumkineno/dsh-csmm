// 视图模型：把领域状态包装成视图可直接绑定的状态 + 命令。
// 依赖方向只有一个：view -> viewmodel -> contracts/selectors；Mock 由组合根注入。
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  Actions,
  AppState,
  AppViewModel,
  Bootstrap,
  CustomPrompt,
  Group,
  GroupItem,
  GroupItemKind,
  HostPort,
  McpServer,
  ModalPatch,
  ModalState,
  PageTab,
  Scope,
  Skill,
  ToastItem,
} from '../contracts'
import { selectors, scopeKey } from '../model/selectors'

const ViewModelContext = createContext<AppViewModel | null>(null)

export function useAppViewModel(): AppViewModel {
  const vm = useContext(ViewModelContext)
  if (!vm) throw new Error('useAppViewModel must be used within AppViewModelProvider')
  return vm
}

function makeInitialState(bootstrap: Bootstrap): AppState {
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
    modal: null,
    toasts: [],
    meta: {
      workspaces: bootstrap.workspaces,
      sections: bootstrap.sections,
    },
    copy: bootstrap.copy,
  }
}

// 每次更新构造一份带独立嵌套容器的快照，命令里可以自由改动，React 仍能感知变化。
function cloneState(prev: AppState): AppState {
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
    modal: prev.modal ? ({ ...prev.modal } as ModalState) : null,
    toasts: [...prev.toasts],
  }
}

export function AppViewModelProvider({ host, children }: { host: HostPort; children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => makeInitialState(host.bootstrap()))
  const seq = useRef(0)

  const mutate = useCallback((fn: (s: AppState) => void) => {
    setState((prev) => {
      const next = cloneState(prev)
      fn(next)
      return next
    })
  }, [])

  const actions = useMemo<Actions>(() => {
    const pushToast = (s: AppState, msg: string, label?: string, fn?: () => void, ttl = 1600): number => {
      const id = ++seq.current
      s.toasts.push({ id, msg, undoLabel: label, undo: fn })
      setTimeout(() => mutate((p) => { p.toasts = p.toasts.filter((t) => t.id !== id) }), ttl)
      return id
    }
    const toast = (msg: string) => mutate((s) => { pushToast(s, msg) })

    const findGroup = (s: AppState, id: string): Group | null => s.groups.find((g) => g.id === id) ?? null
    const findSkill = (s: AppState, name: string): Skill | null => s.skills.find((x) => x.name === name) ?? null
    const findServer = (s: AppState, name: string): McpServer | null => s.servers.find((x) => x.name === name) ?? null
    const mergeSecrets = (base: Record<string, string> | undefined, patch: Record<string, string | null>): Record<string, string> => {
      const out = { ...(base || {}) }
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete out[key]
        else out[key] = value
      }
      return out
    }
    const currentGroupOf = (s: AppState): Group | null => findGroup(s, s.activeGroup[scopeKey(s.scope)])

    const ensureDraftItems = (s: AppState, group: Group): GroupItem[] => {
      const key = selectors.draftId(group)
      if (!s.drafts[key] || !Array.isArray(s.drafts[key])) {
        const target = findGroup(s, group.id)
        const source = target ? target.items : group.items
        s.drafts[key] = source.map((it) => ({ kind: it.kind, name: it.name }))
      }
      return s.drafts[key] as GroupItem[]
    }

    return {
      // ---- 导航 ----
      setScope(scope) {
        mutate((s) => {
          s.scope = scope
          s.detail = null
          s.sel = { skill: null, mcp: null }
          const gid = s.activeGroup[scopeKey(scope)]
          s.active = { kind: 'group', id: gid && s.groups.some((g) => g.id === gid) ? gid : null }
        })
      },
      setTab(tab: PageTab) {
        mutate((s) => { s.tab = tab; s.detail = null; s.sel = { skill: null, mcp: null } })
      },
      setActive(kind, id) {
        mutate((s) => {
          s.detail = null
          s.active = { kind, id }
        })
      },
      setEffectiveGroup(id) {
        mutate((s) => {
          const g = findGroup(s, id)
          if (!g) return
          const k = scopeKey(g.scope)
          const prev = s.activeGroup[k] || null
          if (prev === id) return
          s.activeGroup[k] = id
          s.active = { kind: 'group', id }
          s.detail = null
          pushToast(s, '已设为生效分组：' + (g.name || '未命名分组'), '撤销', () => mutate((p) => {
            if (prev) p.activeGroup[k] = prev
            else delete p.activeGroup[k]
          }), 6000)
        })
      },
      setNone() {
        mutate((s) => {
          delete s.activeGroup[scopeKey(s.scope)]
          s.active = { kind: 'group', id: null }
          s.detail = null
        })
      },
      openDetail(detail) { mutate((s) => { s.detail = detail }) },
      closeDetail() { mutate((s) => { s.detail = null }) },
      selectSkill(name) { mutate((s) => { s.sel = { skill: s.sel.skill === name ? null : name, mcp: null } }) },
      selectMcp(name) { mutate((s) => { s.sel = { skill: null, mcp: s.sel.mcp === name ? null : name } }) },

      // ---- 列表栏 ----
      newGroup() {
        mutate((s) => {
          const n = selectors.groupsOf(s.groups, s.scope).length + 1
          const g: Group = { id: 'g' + Date.now(), name: '分组 ' + n, scope: { ...s.scope }, enabled: true, items: [] }
          s.groups.push(g)
          s.active = { kind: 'group', id: g.id }
          s.detail = null
          pushToast(s, '已创建分组（尚未生效，可编辑后设为生效）')
        })
      },
      newCustom() {
        mutate((s) => {
          const n = selectors.customsOf(s.customs, s.scope).length + 1
          const c: CustomPrompt = { id: 'c' + Date.now(), title: '自定义 ' + n, scope: { ...s.scope }, text: '' }
          s.customs.push(c)
          s.active = { kind: 'custom', id: c.id }
          s.detail = null
        })
      },
      setQuery(field, value) { mutate((s) => { s.q[field] = value }) },
      setToolQuery(name, value) {
        mutate((s) => { const srv = findServer(s, name); if (srv) srv.toolQ = value })
      },
      toggleSkillCheck(name) {
        mutate((s) => {
          const i = s.skillSel.indexOf(name)
          if (i < 0) s.skillSel.push(name)
          else s.skillSel.splice(i, 1)
        })
      },
      setSkillSel(arr) { mutate((s) => { s.skillSel = arr }) },
      setShowPlugin(v) { mutate((s) => { s.showPlugin = v }) },

      // ---- 分组 / 自定义 编辑 ----
      ensureDraft(group) { mutate((s) => { ensureDraftItems(s, group) }) },
      toggleDraftCheck(group, kind: GroupItemKind, name: string) {
        mutate((s) => {
          const draft = ensureDraftItems(s, group)
          const i = draft.findIndex((it) => it.kind === kind && it.name === name)
          if (i < 0) draft.push({ kind, name })
          else draft.splice(i, 1)
        })
      },
      addDraftItem(group, kind: GroupItemKind, name: string) {
        mutate((s) => {
          const draft = ensureDraftItems(s, group)
          if (!selectors.hasItem(draft, kind, name)) draft.push({ kind, name })
        })
      },
      saveGroup(group, name) {
        mutate((s) => {
          const target = findGroup(s, group.id)
          if (!target) return
          const k = selectors.draftId(group)
          target.name = (name || '').trim() || '未命名分组'
          const draft = (s.drafts[k] as GroupItem[] | undefined) || target.items
          target.items = draft.map((it) => ({ kind: it.kind, name: it.name }))
          s.saved[target.id] = JSON.stringify(target.items)
          delete s.drafts[k]
        })
        toast('分组已保存')
      },
      revertGroup(group) {
        mutate((s) => {
          const target = findGroup(s, group.id)
          if (target && s.saved[target.id]) target.items = JSON.parse(s.saved[target.id]) as GroupItem[]
          delete s.drafts[selectors.draftId(group)]
        })
      },
      setCustomDraft(id, name, text) {
        mutate((s) => { s.drafts['custom:' + id] = { name, text } })
      },
      saveCustom(custom, name, text) {
        mutate((s) => {
          const target = s.customs.find((x) => x.id === custom.id)
          if (!target) return
          target.title = (name || '').trim() || '未命名自定义'
          target.text = text
          s.saved[target.id] = JSON.stringify(target.text)
          delete s.drafts['custom:' + target.id]
        })
        toast('已保存')
      },
      revertCustom(custom) {
        mutate((s) => {
          const target = s.customs.find((x) => x.id === custom.id)
          if (target && s.saved[target.id]) target.text = JSON.parse(s.saved[target.id]) as string
          delete s.drafts['custom:' + custom.id]
        })
      },
      deleteItem(item, kind) {
        mutate((s) => {
          if (kind === 'group') {
            const group = item as Group
            const idx = s.groups.findIndex((g) => g.id === group.id)
            if (idx < 0) return
            const removed = s.groups.splice(idx, 1)[0]
            const k = scopeKey(group.scope)
            const wasActive = s.activeGroup[k] === group.id
            if (wasActive) delete s.activeGroup[k]
            s.active = { kind: 'group', id: null }
            pushToast(s, '已删除分组', '撤销', () => mutate((p) => {
              p.groups.splice(Math.min(idx, p.groups.length), 0, { ...removed, scope: { ...removed.scope }, items: removed.items.map((it) => ({ ...it })) })
              if (wasActive) p.activeGroup[k] = removed.id
              p.active = { kind: 'group', id: removed.id }
            }), 6000)
          } else {
            const custom = item as CustomPrompt
            const idx = s.customs.findIndex((c) => c.id === custom.id)
            if (idx < 0) return
            const removed = s.customs.splice(idx, 1)[0]
            s.active = { kind: 'group', id: null }
            pushToast(s, '已删除自定义', '撤销', () => mutate((p) => {
              p.customs.splice(Math.min(idx, p.customs.length), 0, { ...removed, scope: { ...removed.scope } })
              p.active = { kind: 'custom', id: removed.id }
            }), 6000)
          }
        })
      },

      // ---- 资源成员关系 ----
      setGroupItem(kind, name) {
        mutate((s) => {
          const g = currentGroupOf(s)
          if (!g) { pushToast(s, '当前作用域没有启用的分组'); return }
          const added = !selectors.hasItem(g.items, kind, name)
          if (added) g.items.push({ kind, name })
          else g.items = g.items.filter((it) => !(it.kind === kind && it.name === name))
          s.saved[g.id] = JSON.stringify(g.items)
          delete s.drafts[selectors.draftId(g)]
          pushToast(s, added ? '已加入分组' : '已从分组移除')
        })
      },
      addSkillsToGroup(names) {
        mutate((s) => {
          const g = currentGroupOf(s)
          if (!g) { pushToast(s, '当前作用域没有启用的分组'); return }
          let added = 0
          ;(names || []).forEach((n) => {
            if (!selectors.hasItem(g.items, 'skill', n)) {
              g.items.push({ kind: 'skill', name: n })
              added += 1
            }
          })
          s.saved[g.id] = JSON.stringify(g.items)
          delete s.drafts[selectors.draftId(g)]
          pushToast(s, added ? '已加入分组 ' + added + ' 项' : '所选技能已在分组中')
        })
      },

      // ---- 技能管理 ----
      toggleSkill(name) {
        mutate((s) => {
          if (s.scope.kind === 'global') {
            const sk = findSkill(s, name)
            if (sk) sk.enabled = sk.enabled === false
          } else {
            const k = scopeKey(s.scope)
            const next = !selectors.effSkillEnabled(s, name)
            if (next === selectors.effSkillEnabled(s, name, k)) {
              if (s.overrides.skill[k]) delete s.overrides.skill[k][name]
            } else {
              s.overrides.skill[k] = s.overrides.skill[k] || {}
              s.overrides.skill[k][name] = next
            }
          }
        })
        mutate((s) => {
          const sk = findSkill(s, name)
          if (sk) pushToast(s, (selectors.effSkillEnabled(s, name) ? '已启用 ' : '已停用 ') + name)
        })
      },
      setSkDelConfirm(name) { mutate((s) => { s.skDelConfirm = name }) },
      deleteSkill(name) {
        mutate((s) => {
          const idx = s.skills.findIndex((x) => x.name === name)
          if (idx < 0) return
          const removed = s.skills.splice(idx, 1)[0]
          s.skDelConfirm = null
          s.skillSel = s.skillSel.filter((n) => n !== name)
          if (s.sel.skill === name) {
            const vis = s.skills.filter((x) => selectors.skillVisible(x, s.scope, s.meta))
            s.sel.skill = vis.length ? vis[0].name : null
          }
          pushToast(s, '已删除 ' + name, '撤销', () => mutate((p) => {
            p.skills.splice(Math.min(idx, p.skills.length), 0, { ...removed })
            p.sel.skill = name
          }), 6000)
        })
      },
      moveSkill(name, target) {
        mutate((s) => {
          const sk = findSkill(s, name)
          if (!sk) return
          if (target === 'global') {
            sk.scope = 'global'
            delete sk.wsId
          } else {
            sk.scope = 'workspace'
            sk.wsId = selectors.currentWsId(s.scope, s.meta) || s.meta.workspaces[0].id
          }
          pushToast(s, '已移动 ' + name)
        })
      },
      openSkillDir() { mutate((s) => { pushToast(s, s.copy.skillDir) }) },
      addSkillsFromFiles(files, fromFolder) {
        mutate((s) => {
          const scope = s.scope
          const ws = selectors.currentWsId(scope, s.meta) || (s.meta.workspaces[0] && s.meta.workspaces[0].id)
          const names: string[] = []
          const list = Array.from(files || [])
          if (fromFolder) {
            const seen: Record<string, boolean> = {}
            list.forEach((f) => {
              const rel = f.webkitRelativePath || f.name
              const top = rel.split('/')[0]
              if (!seen[top]) { seen[top] = true; names.push(top) }
            })
          } else {
            const bundle = list.length === 1 && /\.zip$/i.test(list[0].name)
            if (bundle) names.push(list[0].name.replace(/\.zip$/i, ''))
            else list.forEach((f) => {
              if (!/\.(md|markdown)$/i.test(f.name)) return
              names.push(f.name.replace(/\.(md|markdown)$/i, ''))
            })
          }
          let added = 0
          let skipped = 0
          names.forEach((raw) => {
            const name = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
            if (!name || s.skills.some((x) => x.name === name)) { skipped += 1; return }
            s.skills.push({
              name, label: raw, scope: scope.kind === 'global' ? 'global' : 'workspace',
              wsId: scope.kind === 'workspace' ? scope.id ?? undefined : (selectors.currentWsId(scope, s.meta) || ws),
              bytes: 1200, model: true, user: true, enabled: true,
              desc: s.copy.newSkillDesc, text: s.copy.newSkillText,
            })
            added += 1
          })
          if (added) {
            s.sel.skill = s.skills[s.skills.length - 1].name
            pushToast(s, '已添加 ' + added + ' 个技能到' + (scope.kind === 'global' ? '全局' : '当前工作区') + (skipped ? '，跳过 ' + skipped + ' 个' : ''))
          } else {
            pushToast(s, skipped ? '没有可添加的技能（重名或格式不支持）' : '没有选中文件')
          }
        })
      },
      refreshServers() { mutate((s) => { pushToast(s, s.copy.refreshServers) }) },

      // ---- MCP 管理 ----
      toggleTool(serverName, toolName, on) {
        mutate((s) => {
          const srv = findServer(s, serverName)
          if (!srv) return
          if (s.scope.kind === 'global') {
            const t = srv.tools.find((x) => x.name === toolName)
            if (t) t.on = on
          } else {
            const k = scopeKey(s.scope)
            s.overrides.tool[k] = s.overrides.tool[k] || {}
            s.overrides.tool[k][serverName] = s.overrides.tool[k][serverName] || {}
            if (on === selectors.effToolOn(s, serverName, toolName, k)) {
              delete s.overrides.tool[k][serverName][toolName]
              if (!Object.keys(s.overrides.tool[k][serverName]).length) delete s.overrides.tool[k][serverName]
              if (!Object.keys(s.overrides.tool[k]).length) delete s.overrides.tool[k]
            } else s.overrides.tool[k][serverName][toolName] = on
          }
          srv.filterDirty = true
        })
      },
      setAllTools(serverName, on, names) {
        mutate((s) => {
          const srv = findServer(s, serverName)
          if (!srv) return
          const set = names ? new Set(names) : null
          const k = scopeKey(s.scope)
          if (s.scope.kind !== 'global') {
            s.overrides.tool[k] = s.overrides.tool[k] || {}
            s.overrides.tool[k][serverName] = s.overrides.tool[k][serverName] || {}
          }
          srv.tools.forEach((t) => {
            if (set && !set.has(t.name)) return
            if (s.scope.kind === 'global') t.on = on
            else if (on === selectors.effToolOn(s, serverName, t.name, k)) delete s.overrides.tool[k][serverName][t.name]
            else s.overrides.tool[k][serverName][t.name] = on
          })
          srv.filterDirty = true
        })
      },
      saveToolList(serverName) {
        mutate((s) => {
          const srv = findServer(s, serverName)
          if (!srv) return
          srv.filterDirty = false
          const denied = srv.tools.filter((t) => !selectors.effToolOn(s, serverName, t.name)).length
          srv.testMsg = '已保存工具清单：' + denied + ' 个工具 deny' + s.copy.toolSaved
          pushToast(s, '已保存工具清单 · ' + denied + ' 个 deny')
        })
      },
      testConnection(name) {
        let target: McpServer | null = null
        mutate((s) => {
          target = findServer(s, name)
          if (target) target.testing = true
        })
        if (!target) return
        void host.testConnection(target).then((outcome) => {
          mutate((s) => {
            const srv = findServer(s, name)
            if (!srv) return
            srv.testing = false
            srv.tools = outcome.tools.map((t) => ({ ...t }))
            srv.status = outcome.status
            srv.testMsg = outcome.message
            pushToast(s, outcome.toast)
          })
        })
      },
      toggleMcp(name) {
        mutate((s) => {
          if (s.scope.kind === 'global') {
            const srv = findServer(s, name)
            if (!srv) return
            srv.enabled = srv.enabled === false
            srv.testMsg = srv.enabled === false
              ? '已停用：全部 mcp__' + name + '__* 工具从工具定义里消失。'
              : '已启用：工具重新出现在所有作用域。'
          } else {
            const k = scopeKey(s.scope)
            const next = !selectors.effServerEnabled(s, name)
            const layer = '工作区 · ' + selectors.scopeTitle(s.scope, s.meta)
            if (next === selectors.effServerEnabled(s, name, k)) {
              if (s.overrides.mcp[k]) delete s.overrides.mcp[k][name]
            } else {
              s.overrides.mcp[k] = s.overrides.mcp[k] || {}
              s.overrides.mcp[k][name] = next
            }
            const srv = findServer(s, name)
            if (srv) srv.testMsg = next
              ? '已启用：工具仅在「' + layer + '」及上层恢复。'
              : '已停用：全部 mcp__' + name + '__* 工具仅在「' + layer + '」及上层消失。'
          }
        })
      },
      oauthToggle(name) {
        mutate((s) => {
          const srv = findServer(s, name)
          if (!srv) return
          srv.oauth = !srv.oauth
          pushToast(s, srv.oauth ? s.copy.oauthOn : s.copy.oauthOff)
        })
      },
      deleteMcp(name) {
        mutate((s) => {
          const idx = s.servers.findIndex((x) => x.name === name)
          if (idx < 0) return
          const removed = s.servers.splice(idx, 1)[0]
          if (s.sel.mcp === name) s.sel.mcp = s.servers.length ? s.servers[0].name : null
          s.mcpDelConfirm = null
          pushToast(s, '已删除 ' + name, '撤销', () => mutate((p) => {
            p.servers.splice(Math.min(idx, p.servers.length), 0, { ...removed, tools: removed.tools.map((t) => ({ ...t })) })
            p.sel.mcp = name
          }), 6000)
        })
      },
      setMcpDelConfirm(name) { mutate((s) => { s.mcpDelConfirm = name }) },
      restartConnection() { mutate((s) => { pushToast(s, s.copy.restart) }) },

      // ---- 弹窗 ----
      openModal(modal) { mutate((s) => { s.modal = modal }) },
      closeModal() { mutate((s) => { s.modal = null }) },
      updateModal(patch: ModalPatch) { mutate((s) => { if (s.modal) s.modal = { ...s.modal, ...patch } as ModalState }) },
      openSkillAdd() { mutate((s) => { s.modal = { type: 'skillAdd' } }) },
      openMigrate(preselect) {
        mutate((s) => { s.modal = { type: 'migrate', target: '', mode: 'copy', checked: preselect || [] } })
      },
      runMigrate() {
        mutate((s) => {
          const m = s.modal
          if (!m || m.type !== 'migrate') return
          if (!m.target) { pushToast(s, '请选择目标工作区'); return }
          if (!m.checked.length) { pushToast(s, '请至少选择一个技能'); return }
          const ws = s.meta.workspaces.find((w) => w.id === m.target)
          let moved = 0
          m.checked.forEach((name) => {
            const sk = findSkill(s, name)
            if (!sk) return
            if (m.mode === 'move') {
              sk.scope = 'workspace'
              sk.wsId = m.target
            } else {
              if (s.skills.some((x) => x.name === name && x.wsId === m.target)) return
              s.skills.push({ ...sk, scope: 'workspace', wsId: m.target })
            }
            moved += 1
          })
          s.modal = null
          s.skillSel = []
          pushToast(s, (m.mode === 'move' ? '已移动 ' : '已复制 ') + moved + ' 项到 ' + (ws ? ws.title : m.target))
        })
      },
      openServerForm(srv, isNew) {
        mutate((s) => {
          s.modal = { type: 'serverForm', editing: isNew || !srv ? '' : srv.name }
        })
      },
      saveServer(input, editing) {
        mutate((s) => {
          const modal = s.modal
          if (!modal || modal.type !== 'serverForm') return
          const name = input.serverName.trim()
          const existing = findServer(s, name)
          if (existing && existing.name !== editing) {
            s.modal = { ...modal, error: '同名服务器已存在：' + name }
            return
          }
          const srv = editing ? findServer(s, editing) : null
          if (editing && !srv) return
          const target: McpServer = srv ?? {
            name, label: name, status: 'disconnected', transport: input.transport,
            tokens: 0, auth: input.authMode, enabled: true, tools: [], instructions: '',
          }
          target.name = name
          target.label = name
          target.transport = input.transport
          target.auth = input.authMode
          if (input.transport === 'http') {
            target.url = input.url
            delete target.command
            delete target.args
            delete target.cwd
          } else {
            target.command = input.command
            target.args = input.args
            target.cwd = input.cwd || undefined
            delete target.url
          }
          target.env = input.transport === 'stdio' ? mergeSecrets(target.env, input.env) : {}
          target.envKeys = Object.keys(target.env)
          target.headers = input.transport === 'http' ? mergeSecrets(target.headers, input.headers) : {}
          target.headerKeys = Object.keys(target.headers)
          target.toolCallTimeoutMs = input.toolCallTimeoutMs
          target.failOnStartupError = input.failOnStartupError
          target.reconnect = input.reconnect
          if (input.authMode === 'oauth') target.oauth = target.oauth ?? false
          else delete target.oauth
          if (!srv) {
            s.servers.push(target)
            s.sel.mcp = name
            pushToast(s, '已添加 ' + name + '，点「测试连接」拉工具清单')
          } else {
            if (s.sel.mcp === editing) s.sel.mcp = name
            pushToast(s, '已保存 ' + name + s.copy.serverSaved)
          }
          s.modal = null
        })
      },
      openRaw(srv) {
        const yaml = 'kind: mcp-server\nserverName: ' + srv.name + '\ntransport: ' + srv.transport + '\n' +
          (srv.transport === 'stdio'
            ? 'command: npx\nargs:\n  - -y\n  - @modelcontextprotocol/server-github\n'
            : 'url: https://api.github.com/mcp\nheaders:\n  Authorization: Bearer <token>\n') +
          'toolCallTimeoutMs: 60000\nmaxInstructionBytes: 8192'
        mutate((s) => { s.modal = { type: 'raw', serverName: srv.name, text: yaml } })
      },
      rawSave() { mutate((s) => { s.modal = null; pushToast(s, s.copy.rawSaved) }) },

      // ---- Toast ----
      removeToast(id) { mutate((s) => { s.toasts = s.toasts.filter((t) => t.id !== id) }) },
      runToastUndo(t: ToastItem) { if (t.undo) t.undo(); mutate((s) => { s.toasts = s.toasts.filter((x) => x.id !== t.id) }) },
      toast,
    }
  }, [mutate, host])

  const value = useMemo<AppViewModel>(() => ({ state, actions, selectors }), [state, actions])

  return <ViewModelContext.Provider value={value}>{children}</ViewModelContext.Provider>
}
