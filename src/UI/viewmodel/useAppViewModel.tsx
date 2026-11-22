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
import { resolvedServer, resolvedSkill, sameScope, scopeKey, selectors } from '../model/selectors'
import { applyBootstrap, cloneState, makeInitialState } from './state'

const ViewModelContext = createContext<AppViewModel | null>(null)

export function useAppViewModel(): AppViewModel {
  const vm = useContext(ViewModelContext)
  if (!vm) throw new Error('useAppViewModel must be used within AppViewModelProvider')
  return vm
}

type ScopedDef = { name: string; scope: 'global' | 'workspace'; wsId?: string }

const copyGroups = (groups: Group[]): Group[] =>
  groups.map((g) => ({ ...g, scope: { ...g.scope }, items: g.items.map((it) => ({ ...it })) }))

const copyServer = (server: McpServer): McpServer => ({ ...server, tools: server.tools.map((t) => ({ ...t })) })

export function AppViewModelProvider({ host, children }: { host: HostPort; children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => makeInitialState(host.bootstrap()))
  const stateRef = useRef(state)
  stateRef.current = state
  const seq = useRef(0)

  const mutate = useCallback((fn: (s: AppState) => void) => {
    setState((prev) => {
      const next = cloneState(prev)
      fn(next)
      return next
    })
  }, [])

  const actions = useMemo<Actions>(() => {
    const pushToast = (s: AppState, msg: string, label?: string, fn?: () => void, ttl = 3000): number => {
      const id = ++seq.current
      s.toasts.push({ id, msg, undoLabel: label, undo: fn })
      setTimeout(() => mutate((p) => { p.toasts = p.toasts.filter((t) => t.id !== id) }), ttl)
      return id
    }
    const toast = (msg: string) => mutate((s) => { pushToast(s, msg) })

    const workspaceRoot = (s: AppState): string | undefined =>
      s.scope.kind === 'workspace'
        ? s.meta.workspaces.find((w) => w.id === s.scope.id)?.path
        : undefined

    /** 提交写命令，然后用宿主读模型刷新；失败时保留本地状态并提示。 */
    const sync = (command: Record<string, unknown>) => {
      if (!host.send) return
      const s = stateRef.current
      const root = workspaceRoot(s)
      const scope = { ...s.scope }
      void host
        .send(command, root ?? '')
        .then(async () => {
          if (!host.load) return
          const bootstrap = await host.load(scope, root ?? '')
          setState((prev) => applyBootstrap(prev, bootstrap))
        })
        .catch((err: unknown) => {
          toast('保存失败：' + (err instanceof Error ? err.message : String(err)))
        })
    }

    const findGroup = (s: AppState, id: string | undefined): Group | null =>
      id ? s.groups.find((g) => g.id === id) ?? null : null
    const groupInScope = (s: AppState, id: string | undefined): Group | null => {
      const group = findGroup(s, id)
      return group && sameScope(group.scope, s.scope) ? group : null
    }
    /** 当前作用域自己的定义；工作区作用域只认 wsId 匹配的工作区定义。 */
    const currentDef = <T extends ScopedDef>(list: T[], s: AppState, name: string): T | null => {
      const ws = s.scope.kind === 'workspace' ? s.scope.id ?? null : null
      return list.find((x) => x.name === name && (ws
        ? x.scope === 'workspace' && x.wsId === ws
        : x.scope === 'global')) ?? null
    }
    /** 解析当前作用域链上最终生效的定义（工作区同名覆盖全局）。 */
    const resolveSkill = (s: AppState, name: string): Skill | null => resolvedSkill(s, name) ?? null
    const resolveServer = (s: AppState, name: string): McpServer | null => resolvedServer(s, name) ?? null
    /** 写操作先落到当前作用域：工作区没有同名定义时，从全局定义复制一份覆盖。 */
    const ensureSkill = (s: AppState, name: string): Skill | null => {
      const local = currentDef(s.skills, s, name)
      if (local) return local
      const base = resolveSkill(s, name)
      if (!base) return null
      if (s.scope.kind === 'global') return base
      const copy: Skill = { ...base, scope: 'workspace', wsId: s.scope.id ?? undefined }
      s.skills.push(copy)
      return copy
    }
    const ensureServer = (s: AppState, name: string): McpServer | null => {
      const local = currentDef(s.servers, s, name)
      if (local) return local
      const base = resolveServer(s, name)
      if (!base) return null
      if (s.scope.kind === 'global') return base
      const copy: McpServer = { ...copyServer(base), scope: 'workspace', wsId: s.scope.id ?? undefined }
      s.servers.push(copy)
      return copy
    }
    const mergeSecrets = (base: Record<string, string> | undefined, patch: Record<string, string | null>): Record<string, string> => {
      const out = { ...(base || {}) }
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete out[key]
        else out[key] = value
      }
      return out
    }
    const currentGroupOf = (s: AppState): Group | null => groupInScope(s, s.activeGroup[scopeKey(s.scope)])
    const removeGroupRefs = (s: AppState, kind: GroupItemKind, name: string, scope: Scope | null): void => {
      for (const group of s.groups) {
        if (scope && !sameScope(group.scope, scope)) continue
        group.items = group.items.filter((it) => !(it.kind === kind && it.name === name))
      }
    }
    const uniqueGroupName = (s: AppState): string => {
      let n = selectors.groupsOf(s.groups, s.scope, s.meta).length + 1
      const names = new Set(selectors.groupsOf(s.groups, s.scope, s.meta).map((g) => g.name))
      while (names.has('分组 ' + n)) n += 1
      return '分组 ' + n
    }
    const mergeIntoGroup = (s: AppState, group: Group, kind: GroupItemKind, name: string, add: boolean): void => {
      const draftKey = selectors.draftId(group)
      const draft = Array.isArray(s.drafts[draftKey]) ? (s.drafts[draftKey] as GroupItem[]) : null
      const target = draft || group.items
      const exists = selectors.hasItem(target, kind, name)
      if (add && !exists) target.push({ kind, name })
      if (!add && exists) {
        const next = target.filter((it) => !(it.kind === kind && it.name === name))
        if (draft) s.drafts[draftKey] = next
        else group.items = next
      }
      if (!draft) s.saved[group.id] = JSON.stringify(group.items)
    }

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
          s.scope = { ...scope }
          s.detail = null
          s.sel = { skill: null, mcp: null }
          const gid = s.activeGroup[scopeKey(scope)]
          s.active = { kind: 'group', id: gid && s.groups.some((g) => g.id === gid && sameScope(g.scope, scope)) ? gid : null }
          if (scope.kind === 'workspace' && scope.id) {
            const ws = s.meta.workspaces.find((w) => w.id === scope.id)
            if (ws && ws.trusted === false && !s.trustDeclined.includes(ws.id) && !s.modal) {
              s.modal = { type: 'workspaceTrust', wsId: ws.id }
            }
          }
        })
        if (host.load) {
          const ws = stateRef.current.meta.workspaces.find((w) => w.id === scope.id)
          void host
            .load(scope, ws?.path ?? '')
            .then((bootstrap) => setState((prev) => applyBootstrap(prev, bootstrap)))
            .catch((err: unknown) => {
              toast('读取作用域失败：' + (err instanceof Error ? err.message : String(err)))
            })
        }
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
          const prev = s.activeGroup[k] ?? ''
          // 先把尚未保存的分组草稿落盘，避免「设为生效」后预览仍是旧内容。
          const draftKey = selectors.draftId(g)
          if (Array.isArray(s.drafts[draftKey])) {
            g.items = (s.drafts[draftKey] as GroupItem[]).map((it) => ({ kind: it.kind, name: it.name }))
            s.saved[g.id] = JSON.stringify(g.items)
            delete s.drafts[draftKey]
          }
          s.activeGroup[k] = id
          s.active = { kind: 'group', id }
          s.detail = null
          pushToast(s, '已保存并设为生效：' + (g.name || '未命名分组'), '撤销', () => mutate((p) => {
            if (prev) p.activeGroup[k] = prev
            else delete p.activeGroup[k]
          }), 6000)
        })
        const target = findGroup(stateRef.current, id)
        if (target) sync({ type: 'group.effective', scope: target.scope, groupId: id })
      },
      inheritGroup() {
        mutate((s) => {
          const key = scopeKey(s.scope)
          delete s.activeGroup[key]
          s.active = { kind: 'group', id: null }
          s.detail = null
          pushToast(s, '已恢复继承（沿用下层分组）')
        })
        sync({ type: 'group.inherit', scope: stateRef.current.scope })
      },
      setNone() {
        mutate((s) => {
          s.activeGroup[scopeKey(s.scope)] = ''
          s.active = { kind: 'group', id: null }
          s.detail = null
          pushToast(s, '本层已声明不使用分组（阻断继承）')
        })
        sync({ type: 'group.none', scope: stateRef.current.scope })
      },
      openDetail(detail) { mutate((s) => { s.detail = detail }) },
      closeDetail() { mutate((s) => { s.detail = null }) },
      selectSkill(name) { mutate((s) => { s.sel = { skill: s.sel.skill === name ? null : name, mcp: null } }) },
      selectMcp(name) { mutate((s) => { s.sel = { skill: null, mcp: s.sel.mcp === name ? null : name } }) },

      // ---- 列表栏 ----
      newGroup() {
        mutate((s) => {
          const g: Group = { id: 'g' + Date.now(), name: uniqueGroupName(s), scope: { ...s.scope }, enabled: true, items: [] }
          s.groups.push(g)
          s.active = { kind: 'group', id: g.id }
          s.detail = null
          pushToast(s, '已创建分组（尚未生效，可编辑后设为生效）')
        })
      },
      newCustom() {
        mutate((s) => {
          const n = selectors.customsOf(s.customs, s.scope, s.meta).length + 1
          const c: CustomPrompt = { id: 'c' + Date.now(), title: '自定义 ' + n, scope: { ...s.scope }, text: '' }
          s.customs.push(c)
          s.active = { kind: 'custom', id: c.id }
          s.detail = null
        })
      },
      setQuery(field, value) { mutate((s) => { s.q[field] = value }) },
      setToolQuery(name, value) {
        mutate((s) => { const srv = ensureServer(s, name); if (srv) srv.toolQ = value })
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
        const before = stateRef.current
        const original = findGroup(before, group.id) ?? group
        const draft = (before.drafts[selectors.draftId(group)] as GroupItem[] | undefined) ?? original.items
        const next: Group = {
          ...original,
          name: (name || '').trim() || '未命名分组',
          items: draft.map((it) => ({ kind: it.kind, name: it.name })),
        }
        mutate((s) => {
          const target = findGroup(s, group.id)
          if (!target) return
          const k = selectors.draftId(group)
          target.name = next.name
          target.items = next.items.map((it) => ({ kind: it.kind, name: it.name }))
          s.saved[target.id] = JSON.stringify(target.items)
          delete s.drafts[k]
          pushToast(s, '分组已保存')
        })
        sync({ type: 'group.save', scope: next.scope, group: next, name: next.name })
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
        const before = stateRef.current
        const target = before.customs.find((x) => x.id === custom.id) ?? custom
        const next: CustomPrompt = {
          ...target,
          title: (name || '').trim() || '未命名自定义',
          text,
        }
        mutate((s) => {
          const current = s.customs.find((x) => x.id === custom.id)
          if (!current) return
          current.title = next.title
          current.text = next.text
          s.saved[current.id] = JSON.stringify(current.text)
          delete s.drafts['custom:' + current.id]
          pushToast(s, '已保存')
        })
        sync({ type: 'custom.save', scope: next.scope, custom: next })
      },
      toggleCustom(id) {
        mutate((s) => {
          const target = s.customs.find((x) => x.id === id)
          if (!target) return
          target.enabled = target.enabled === false
        })
        const target = stateRef.current.customs.find((x) => x.id === id)
        if (target) sync({ type: 'custom.toggle', scope: target.scope, id })
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
        if (kind === 'group') {
          const group = item as Group
          sync({ type: 'group.delete', scope: group.scope, id: group.id })
        } else {
          const custom = item as CustomPrompt
          sync({ type: 'custom.delete', scope: custom.scope, id: custom.id })
        }
      },

      // ---- 资源成员关系 ----
      setGroupItem(kind, name) {
        mutate((s) => {
          const g = currentGroupOf(s)
          if (!g) { pushToast(s, '当前作用域没有启用的分组'); return }
          const draftKey = selectors.draftId(g)
          const hasDraft = Array.isArray(s.drafts[draftKey])
          const target = hasDraft ? (s.drafts[draftKey] as GroupItem[]) : g.items
          const added = !selectors.hasItem(target, kind, name)
          if (added) {
            if (hasDraft) (s.drafts[draftKey] as GroupItem[]).push({ kind, name })
            else g.items.push({ kind, name })
          } else if (hasDraft) {
            s.drafts[draftKey] = (s.drafts[draftKey] as GroupItem[]).filter((it) => !(it.kind === kind && it.name === name))
          } else {
            g.items = g.items.filter((it) => !(it.kind === kind && it.name === name))
          }
          if (!hasDraft) s.saved[g.id] = JSON.stringify(g.items)
          pushToast(s, added ? '已加入当前分组' : '已从当前分组移除')
        })
      },
      addSkillsToGroup(names) {
        mutate((s) => {
          const g = currentGroupOf(s)
          if (!g) { pushToast(s, '当前作用域没有启用的分组'); return }
          const draftKey = selectors.draftId(g)
          const hasDraft = Array.isArray(s.drafts[draftKey])
          const target = hasDraft ? (s.drafts[draftKey] as GroupItem[]) : g.items
          let added = 0
          ;(names || []).forEach((n) => {
            if (!selectors.hasItem(target, 'skill', n)) { target.push({ kind: 'skill', name: n }); added += 1 }
          })
          if (!hasDraft) s.saved[g.id] = JSON.stringify(g.items)
          pushToast(s, added
            ? '已加入分组 ' + added + ' 项' + (hasDraft ? '（有未保存更改）' : '')
            : '所选技能已在分组中')
        })
      },

      // ---- 技能管理 ----
      toggleSkill(name) {
        mutate((s) => {
          const sk = ensureSkill(s, name)
          if (!sk) return
          sk.enabled = sk.enabled === false
          pushToast(s, (sk.enabled === false ? '已停用 ' : '已启用 ') + name
            + (sk.scope === 'workspace' ? '（当前工作区）' : '（全局）'))
        })
        const s = stateRef.current
        const local = currentDef(s.skills, s, name)
        const base = local ?? resolveSkill(s, name)
        if (base) {
          const scope: Scope = local
            ? local.scope === 'global'
              ? { kind: 'global', id: null }
              : { kind: 'workspace', id: local.wsId }
            : { ...s.scope }
          sync({
            type: 'skill.save',
            scope,
            skill: {
              ...base,
              scope: scope.kind,
              wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined,
              enabled: (local ? local.enabled !== false : base.enabled !== false) === false,
            },
          })
        }
      },
      setSkDelConfirm(name) { mutate((s) => { s.skDelConfirm = name }) },
      deleteSkill(name) {
        const localBefore = currentDef(stateRef.current.skills, stateRef.current, name)
        const scopeBefore = localBefore?.scope === 'global'
          ? { kind: 'global' as const, id: null }
          : localBefore?.scope === 'workspace'
            ? { kind: 'workspace' as const, id: localBefore.wsId }
            : { ...stateRef.current.scope }
        mutate((s) => {
          const local = currentDef(s.skills, s, name)
          const snapshot = copyGroups(s.groups)
          if (!local) {
            const resolved = resolveSkill(s, name)
            if (!resolved) return
            if (s.scope.kind === 'workspace') {
              const copy = ensureSkill(s, name)
              if (!copy) return
              copy.enabled = false
              s.skDelConfirm = null
              pushToast(s, '已在本工作区停用 ' + name + '（全局定义仍保留）')
              return
            }
            // 全局定义缺失时不再兜底。
            s.skDelConfirm = null
            return
          }
          const idx = s.skills.findIndex((x) => x === local)
          const removed = s.skills.splice(idx, 1)[0]
          removeGroupRefs(s, 'skill', name, s.scope)
          s.skDelConfirm = null
          s.skillSel = s.skillSel.filter((n) => n !== name)
          if (s.sel.skill === name) {
            const vis = selectors.visibleSkills(s)
            s.sel.skill = vis.length ? vis[0].name : null
          }
          pushToast(s, '已删除 ' + name + (local.scope === 'workspace' ? '（当前工作区覆盖）' : '（全局定义）'), '撤销', () => mutate((p) => {
            p.skills.splice(Math.min(idx, p.skills.length), 0, { ...removed })
            p.groups = copyGroups(snapshot)
            p.sel.skill = name
          }), 6000)
        })
        if (localBefore) {
          sync({ type: 'skill.delete', scope: scopeBefore, name })
        } else if (scopeBefore.kind === 'workspace') {
          const base = resolveSkill(stateRef.current, name)
          if (base) sync({ type: 'skill.save', scope: scopeBefore, skill: { ...base, scope: 'workspace', wsId: scopeBefore.id ?? undefined, enabled: false } })
        }
      },
      moveSkill(name, target) {
        const before = stateRef.current
        const local = currentDef(before.skills, before, name)
        const base = local || resolveSkill(before, name)
        const wsId = before.scope.kind === 'workspace' ? before.scope.id ?? undefined : before.meta.workspaces[0]?.id
        mutate((s) => {
          const local = currentDef(s.skills, s, name)
          const base = local || resolveSkill(s, name)
          if (!base) return
          const wsId = s.scope.kind === 'workspace' ? s.scope.id ?? undefined : s.meta.workspaces[0]?.id
          if (target === 'global') {
            if (s.skills.some((x) => x.name === name && x.scope === 'global')) { pushToast(s, name + ' 已在全局定义中'); return }
            s.skills.push({ ...base, scope: 'global', wsId: undefined })
            pushToast(s, '已复制到全局：' + name)
          } else {
            if (s.skills.some((x) => x.name === name && x.scope === 'workspace' && x.wsId === wsId)) {
              pushToast(s, name + ' 已在当前工作区定义中')
              return
            }
            s.skills.push({ ...base, scope: 'workspace', wsId })
            pushToast(s, '已复制到当前工作区：' + name)
          }
        })
        if (base) {
          const from: Scope = base.scope === 'global'
            ? { kind: 'global', id: null }
            : { kind: 'workspace', id: base.wsId }
          const to: Scope = target === 'global'
            ? { kind: 'global', id: null }
            : { kind: 'workspace', id: wsId }
          sync({ type: 'skill.copy', from, to, names: [name] })
        }
      },
      openSkillDir() { mutate((s) => { pushToast(s, s.copy.skillDir) }) },
      addSkillsFromFiles(files, fromFolder) {
        mutate((s) => {
          const scope = s.scope
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
            if (!name || currentDef(s.skills, s, name)) { skipped += 1; return }
            s.skills.push({
              name, label: raw, scope: scope.kind === 'global' ? 'global' : 'workspace',
              wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined,
              bytes: 1200, model: true, user: true, enabled: true,
              desc: s.copy.newSkillDesc, text: s.copy.newSkillText,
            })
            added += 1
          })
          if (added) {
            const vis = selectors.visibleSkills(s)
            s.sel.skill = vis.length ? vis[vis.length - 1].name : null
            pushToast(s, '已添加 ' + added + ' 个技能到' + (scope.kind === 'global' ? '全局' : '当前工作区') + (skipped ? '，跳过 ' + skipped + ' 个' : ''))
          } else {
            pushToast(s, skipped ? '没有可添加的技能（当前作用域已有同名定义）' : '没有选中文件')
          }
        })
      },
      refreshServers() { mutate((s) => { pushToast(s, s.copy.refreshServers) }) },

      // ---- MCP 管理 ----
      toggleTool(serverName, toolName, on) {
        mutate((s) => {
          const srv = ensureServer(s, serverName)
          if (!srv) return
          const tool = srv.tools.find((x) => x.name === toolName)
          if (tool) tool.on = on
          srv.filterDirty = true
        })
        const s = stateRef.current
        const srv = currentDef(s.servers, s, serverName) ?? resolveServer(s, serverName)
        if (srv) {
          const scope: Scope = srv.scope === 'global' ? { kind: 'global', id: null } : { kind: 'workspace', id: srv.wsId }
          sync({ type: 'mcp.tools', scope, name: serverName, tools: srv.tools.map((t) => ({ ...t, on: t.name === toolName ? on : t.on })) })
        }
      },
      setAllTools(serverName, on, names) {
        mutate((s) => {
          const srv = ensureServer(s, serverName)
          if (!srv) return
          const set = names ? new Set(names) : null
          srv.tools.forEach((t) => {
            if (set && !set.has(t.name)) return
            t.on = on
          })
          srv.filterDirty = true
        })
        const s = stateRef.current
        const srv = currentDef(s.servers, s, serverName) ?? resolveServer(s, serverName)
        if (srv) {
          const scope: Scope = srv.scope === 'global' ? { kind: 'global', id: null } : { kind: 'workspace', id: srv.wsId }
          const set = names ? new Set(names) : null
          sync({
            type: 'mcp.tools',
            scope,
            name: serverName,
            tools: srv.tools.map((t) => ({ ...t, on: set && !set.has(t.name) ? t.on : on })),
          })
        }
      },
      saveToolList(serverName) {
        mutate((s) => {
          const srv = currentDef(s.servers, s, serverName) || resolveServer(s, serverName)
          if (!srv) return
          srv.filterDirty = false
          const denied = srv.tools.filter((t) => t.on === false).length
          srv.testMsg = '已保存工具清单：' + denied + ' 个工具 deny' + s.copy.toolSaved
          pushToast(s, '已保存工具清单 · ' + denied + ' 个 deny')
        })
      },
      testConnection(name) {
        let target: McpServer | null = null
        mutate((s) => {
          target = currentDef(s.servers, s, name) || resolveServer(s, name) || null
          if (target && currentDef(s.servers, s, name)) target.testing = true
        })
        if (!target) return
        void host.testConnection(target).then((outcome) => {
          mutate((s) => {
            const srv = currentDef(s.servers, s, name)
            if (srv) {
              srv.testing = false
              srv.tools = outcome.tools.map((t) => ({ ...t }))
              srv.status = outcome.status
              srv.testMsg = outcome.message
            }
            pushToast(s, outcome.toast + (srv ? '' : '（继承定义未被改写）'))
          })
        })
      },
      toggleMcp(name) {
        mutate((s) => {
          const srv = ensureServer(s, name)
          if (!srv) return
          srv.enabled = srv.enabled === false
          srv.testMsg = srv.enabled === false
            ? '已停用：全部 mcp__' + name + '__* 工具从这份定义里消失。'
            : '已启用：工具重新出现在当前作用域链。'
          pushToast(s, (srv.enabled === false ? '已停用 ' : '已启用 ') + name
            + (srv.scope === 'workspace' ? '（当前工作区）' : '（全局）'))
        })
        const s = stateRef.current
        const local = currentDef(s.servers, s, name)
        const base = local ?? resolveServer(s, name)
        if (base) {
          const scope: Scope = s.scope
          sync({
            type: 'mcp.save',
            scope,
            server: { ...base, scope: scope.kind, wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined, enabled: (local ? local.enabled !== false : base.enabled !== false) === false },
          })
        }
      },
      oauthToggle(name) {
        mutate((s) => {
          const srv = ensureServer(s, name)
          if (!srv) return
          srv.oauth = !srv.oauth
          pushToast(s, srv.oauth ? s.copy.oauthOn : s.copy.oauthOff)
        })
        const s = stateRef.current
        const local = currentDef(s.servers, s, name)
        const base = local ?? resolveServer(s, name)
        if (base) {
          const scope: Scope = s.scope
          sync({
            type: 'mcp.save',
            scope,
            server: { ...base, scope: scope.kind, wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined, oauth: base.oauth !== true },
          })
        }
      },
      deleteMcp(name) {
        const localBefore = currentDef(stateRef.current.servers, stateRef.current, name)
        const scopeBefore: Scope = localBefore?.scope === 'global'
          ? { kind: 'global', id: null }
          : localBefore?.scope === 'workspace'
            ? { kind: 'workspace', id: localBefore.wsId }
            : { ...stateRef.current.scope }
        mutate((s) => {
          const local = currentDef(s.servers, s, name)
          const snapshot = copyGroups(s.groups)
          if (!local) {
            const resolved = resolveServer(s, name)
            if (!resolved) return
            if (s.scope.kind === 'workspace') {
              const copy = ensureServer(s, name)
              if (!copy) return
              copy.enabled = false
              s.mcpDelConfirm = null
              pushToast(s, '已在本工作区停用 ' + name + '（全局定义仍保留）')
              return
            }
            s.mcpDelConfirm = null
            return
          }
          const idx = s.servers.findIndex((x) => x === local)
          const removed = s.servers.splice(idx, 1)[0]
          removeGroupRefs(s, 'mcp', name, s.scope)
          if (s.sel.mcp === name) {
            const vis = selectors.visibleServers(s)
            s.sel.mcp = vis.length ? vis[0].name : null
          }
          s.mcpDelConfirm = null
          pushToast(s, '已删除 ' + name + (local.scope === 'workspace' ? '（当前工作区覆盖）' : '（全局定义）'), '撤销', () => mutate((p) => {
            p.servers.splice(Math.min(idx, p.servers.length), 0, copyServer(removed))
            p.groups = copyGroups(snapshot)
            p.sel.mcp = name
          }), 6000)
        })
        if (localBefore) {
          sync({ type: 'mcp.delete', scope: scopeBefore, name })
        } else if (scopeBefore.kind === 'workspace') {
          const base = resolveServer(stateRef.current, name)
          if (base) sync({ type: 'mcp.save', scope: scopeBefore, server: { ...base, scope: 'workspace', wsId: scopeBefore.id ?? undefined, enabled: false } })
        }
      },
      setMcpDelConfirm(name) { mutate((s) => { s.mcpDelConfirm = name }) },
      restartConnection() { mutate((s) => { pushToast(s, s.copy.restart) }) },

      // ---- 弹窗 ----
      openModal(modal) { mutate((s) => { s.modal = modal }) },
      closeModal() { mutate((s) => { s.modal = null }) },
      updateModal(patch: ModalPatch) { mutate((s) => { if (s.modal) s.modal = { ...s.modal, ...patch } as ModalState }) },
      openSkillAdd() { mutate((s) => { s.modal = { type: 'skillAdd' } }) },
      openMigrate(preselect) {
        mutate((s) => { s.modal = { type: 'migrate', target: '', checked: preselect || [] } })
      },
      runMigrate() {
        mutate((s) => {
          const m = s.modal
          if (!m || m.type !== 'migrate') return
          if (!m.target) { pushToast(s, '请选择目标工作区'); return }
          if (!m.checked.length) { pushToast(s, '请至少选择一个技能'); return }
          const ws = s.meta.workspaces.find((w) => w.id === m.target)
          let copied = 0
          let skipped = 0
          m.checked.forEach((name) => {
            const base = resolveSkill(s, name)
            if (!base) return
            if (s.skills.some((x) => x.name === name && x.scope === 'workspace' && x.wsId === m.target)) {
              skipped += 1
              return
            }
            s.skills.push({ ...base, scope: 'workspace', wsId: m.target })
            copied += 1
          })
          s.modal = null
          s.skillSel = []
          pushToast(s, '已复制 ' + copied + ' 项到 ' + (ws ? ws.title : m.target) + (skipped ? '，跳过 ' + skipped + ' 项同名定义' : ''))
        })
      },
      openServerForm(srv, isNew) {
        mutate((s) => {
          s.modal = { type: 'serverForm', editing: isNew || !srv ? '' : srv.name }
        })
      },
      saveServer(input, editing) {
        let saved: McpServer | null = null
        mutate((s) => {
          const modal = s.modal
          if (!modal || modal.type !== 'serverForm') return
          const name = input.serverName.trim()
          const local = editing ? currentDef(s.servers, s, editing) : null
          const base = local || (editing ? resolveServer(s, editing) : null)
          if (editing && !base) return
          const collision = currentDef(s.servers, s, name)
          if (collision && collision.name !== editing) {
            s.modal = { ...modal, error: '当前作用域已有同名服务器：' + name }
            return
          }
          let target: McpServer | null = local
          if (!target) {
            if (s.scope.kind === 'workspace' && base) {
              target = { ...copyServer(base), scope: 'workspace', wsId: s.scope.id ?? undefined }
              s.servers.push(target)
            } else if (s.scope.kind === 'workspace') {
              target = {
                name, label: name, scope: 'workspace', wsId: s.scope.id ?? undefined,
                status: 'disconnected', transport: input.transport, tokens: 0, auth: input.authMode,
                enabled: true, tools: [], instructions: '',
              }
              s.servers.push(target)
            } else {
              target = {
                name, label: name, scope: 'global', status: 'disconnected', transport: input.transport,
                tokens: 0, auth: input.authMode, enabled: true, tools: [], instructions: '',
              }
              s.servers.push(target)
            }
          }
          if (!target) return
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
          if (editing && editing !== name) {
            for (const group of s.groups) {
              if (!sameScope(group.scope, s.scope)) continue
              group.items = group.items.map((it) => (it.kind === 'mcp' && it.name === editing ? { kind: 'mcp', name } : it))
            }
            if (s.sel.mcp === editing) s.sel.mcp = name
          }
          if (!local && !editing) {
            s.sel.mcp = name
            pushToast(s, '已添加 ' + name + '，点「测试连接」拉工具清单')
          } else {
            pushToast(s, '已保存 ' + name + s.copy.serverSaved + (target.scope === 'workspace' ? '（当前工作区覆盖）' : ''))
          }
          saved = { ...target, tools: target.tools.map((t) => ({ ...t })) }
          s.modal = null
        })
        if (saved) {
          const s = stateRef.current
          const scope: Scope = s.scope
          sync({ type: 'mcp.save', scope, server: saved })
        }
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
      trustWorkspace(wsId) {
        mutate((s) => {
          const ws = s.meta.workspaces.find((w) => w.id === wsId)
          if (ws) ws.trusted = true
          s.trustDeclined = s.trustDeclined.filter((id) => id !== wsId)
          s.modal = null
          pushToast(s, '已信任工作区 ' + (ws ? ws.title : wsId))
        })
        sync({ type: 'trust.set', workspaceId: wsId, trusted: true })
      },
      declineTrust(wsId) {
        mutate((s) => {
          if (!s.trustDeclined.includes(wsId)) s.trustDeclined.push(wsId)
          s.modal = null
          pushToast(s, '已保持受限访问（可随时在左栏重新信任）')
        })
      },

      // ---- Toast ----
      removeToast(id) { mutate((s) => { s.toasts = s.toasts.filter((t) => t.id !== id) }) },
      runToastUndo(t: ToastItem) { if (t.undo) t.undo(); mutate((s) => { s.toasts = s.toasts.filter((x) => x.id !== t.id) }) },
      toast,
    }
  }, [mutate, host])

  const value = useMemo<AppViewModel>(() => ({ state, actions, selectors }), [state, actions])

  return <ViewModelContext.Provider value={value}>{children}</ViewModelContext.Provider>
}
