import type { Actions, GroupItem } from '../../contracts'
import { scopeKey, selectors } from '../../model/selectors'
import type { ActionContext } from '../action-context'
import { findGroup } from '../helpers'

export function createNavigationActions(
  ctx: ActionContext,
): Pick<Actions, 'setTab' | 'setActive' | 'setEffectiveGroup' | 'inheritGroup' | 'setNone' | 'openDetail' | 'closeDetail' | 'selectSkill' | 'selectMcp'> {
  const { mutate, getState, sync, pushToast } = ctx
  return {
    setTab(tab) {
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
      const target = findGroup(getState(), id)
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
      sync({ type: 'group.inherit', scope: getState().scope })
    },
    setNone() {
      mutate((s) => {
        s.activeGroup[scopeKey(s.scope)] = ''
        s.active = { kind: 'group', id: null }
        s.detail = null
        pushToast(s, '本层已声明不使用分组（阻断继承）')
      })
      sync({ type: 'group.none', scope: getState().scope })
    },
    openDetail(detail) { mutate((s) => { s.detail = detail }) },
    closeDetail() { mutate((s) => { s.detail = null }) },
    selectSkill(name) { mutate((s) => { s.sel = { skill: s.sel.skill === name ? null : name, mcp: null } }) },
    selectMcp(name) { mutate((s) => { s.sel = { skill: null, mcp: s.sel.mcp === name ? null : name } }) },
  }
}
