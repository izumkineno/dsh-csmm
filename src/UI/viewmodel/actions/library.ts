import type { Actions, CustomPrompt, Group, GroupItem } from '../../contracts'
import { scopeKey, selectors } from '../../model/selectors'
import type { ActionContext } from '../action-context'
import { currentGroupOf, ensureDraftItems, ensureServer, findGroup, uniqueGroupName } from '../helpers'

export function createLibraryActions(
  ctx: ActionContext,
): Pick<Actions, 'newGroup' | 'newCustom' | 'setQuery' | 'setToolQuery' | 'toggleSkillCheck' | 'setSkillSel' | 'setShowPlugin' | 'ensureDraft' | 'toggleDraftCheck' | 'addDraftItem' | 'saveGroup' | 'revertGroup' | 'setCustomDraft' | 'saveCustom' | 'toggleCustom' | 'revertCustom' | 'deleteItem' | 'setGroupItem' | 'addSkillsToGroup'> {
  const { mutate, getState, sync, pushToast } = ctx
  return {
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
    toggleDraftCheck(group, kind, name) {
      mutate((s) => {
        const draft = ensureDraftItems(s, group)
        const i = draft.findIndex((it) => it.kind === kind && it.name === name)
        if (i < 0) draft.push({ kind, name })
        else draft.splice(i, 1)
      })
    },
    addDraftItem(group, kind, name) {
      mutate((s) => {
        const draft = ensureDraftItems(s, group)
        if (!selectors.hasItem(draft, kind, name)) draft.push({ kind, name })
      })
    },
    saveGroup(group, name) {
      const before = getState()
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
      const before = getState()
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
      const target = getState().customs.find((x) => x.id === id)
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
  }
}
