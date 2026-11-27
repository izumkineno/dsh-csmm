import type { Actions, ResourceRef } from '../../contracts'
import { activationImpact, buildActivationGroup } from '../../../shared/group'
import { scopeKey, selectors } from '../../model/selectors'
import type { ActionContext } from '../action-context'
import { currentGroupOf, findGroup } from '../helpers'

function defaultPromptRef(s: Parameters<typeof selectors.promptCatalog>[0]): ResourceRef | null {
  const catalog = selectors.promptCatalog(s)
  if (catalog.sections[0]) return { kind: 'section', name: catalog.sections[0].name }
  if (catalog.contexts[0]) return { kind: 'context', name: catalog.contexts[0].name }
  if (catalog.tools[0]) return { kind: 'tool', name: catalog.tools[0].name }
  const custom = selectors.customsOf(s.customs, s.scope, s.meta)[0]
  return custom ? { kind: 'custom', id: custom.id } : null
}

export function createNavigationActions(
  ctx: ActionContext,
): Pick<Actions, 'setTab' | 'setActive' | 'setEffectiveGroup' | 'confirmActivateGroup' | 'editInGroup' | 'clearGroupFocus' | 'inheritGroup' | 'setNone' | 'openDetail' | 'closeDetail' | 'selectResource'> {
  const { mutate, getState, sync, pushToast, toast } = ctx

  /** 用一个原子动作保存草稿（含名称）并设为生效。 */
  const activate = (id: string, input?: { name?: string }) => {
    const before = getState()
    const source = findGroup(before, id)
    if (!source) return
    const draft = before.drafts[selectors.draftId(source)]
    const items = (Array.isArray(draft) ? draft : source.items).map((it) => ({ kind: it.kind, name: it.name }))
    const name = (input?.name ?? source.name).trim() || '未命名配置集'
    const next = buildActivationGroup({ ...source, name }, items)
    mutate((s) => {
      const g = findGroup(s, id)
      if (!g) return
      const k = scopeKey(g.scope)
      const hasPrev = Object.prototype.hasOwnProperty.call(s.activeGroup, k)
      const prev = s.activeGroup[k]
      g.name = next.name
      g.items = next.items.map((it) => ({ kind: it.kind, name: it.name }))
      s.saved[g.id] = JSON.stringify(g.items)
      delete s.drafts[selectors.draftId(g)]
      s.activeGroup[k] = id
      s.active = { kind: 'group', id }
      s.detail = null
      s.groupFocus = null
      pushToast(s, '已保存并设为生效：' + (g.name || '未命名配置集'), '撤销', () => mutate((p) => {
        if (hasPrev) p.activeGroup[k] = prev
        else delete p.activeGroup[k]
      }), 6000)
    })
    sync({
      type: 'group.activate',
      scope: source.scope,
      group: next,
      name: next.name,
    })
  }

  return {
    setTab(tab) {
      mutate((s) => {
        s.tab = tab
        s.detail = null
        s.groupFocus = null
        if (tab === 'manage') {
          const own = selectors.groupsOf(s.groups, s.scope, s.meta)
          const selected = s.active.kind === 'group' ? own.find((g) => g.id === s.active.id) : undefined
          if (!selected) {
            const effId = s.activeGroup[scopeKey(s.scope)]
            const eff = effId ? own.find((g) => g.id === effId) : undefined
            s.active = { kind: 'group', id: eff ? eff.id : (own[0]?.id ?? null) }
          }
          return
        }
        if (tab === 'prompt' && !s.selected.prompt) s.selected.prompt = defaultPromptRef(s)
        if (tab === 'skill' && !s.selected.skill) {
          const skill = selectors.visibleSkills(s)[0]
          s.selected.skill = skill ? { kind: 'skill', name: skill.name } : null
        }
        if (tab === 'mcp' && !s.selected.mcp) {
          const server = selectors.visibleServers(s)[0]
          s.selected.mcp = server ? { kind: 'mcp', name: server.name } : null
        }
      })
    },
    setActive(kind, id) {
      mutate((s) => {
        s.detail = null
        s.groupFocus = null
        s.active = { kind, id }
      })
    },
    setEffectiveGroup(id, input) {
      const before = getState()
      const source = findGroup(before, id)
      if (!source) return
      const draft = before.drafts[selectors.draftId(source)]
      const items = (Array.isArray(draft) ? draft : source.items).map((it) => ({ kind: it.kind, name: it.name }))
      const name = (input?.name ?? source.name).trim() || '未命名配置集'
      const impact = activationImpact(buildActivationGroup({ ...source, name }, items))
      if (impact.emptyGroup || impact.noSections || impact.noTools) {
        mutate((s) => { s.modal = { type: 'groupActivate', groupId: id, name } })
        return
      }
      activate(id, { name })
    },
    confirmActivateGroup(id) {
      const m = getState().modal
      const input = m?.type === 'groupActivate' ? { name: m.name } : undefined
      mutate((s) => { s.modal = null })
      activate(id, input)
    },
    editInGroup(kind, name) {
      const group = currentGroupOf(getState())
      if (!group) {
        toast('当前作用域没有自己的配置集；请先新建配置集，或切换到配置集所属作用域')
        return
      }
      mutate((s) => {
        s.tab = 'manage'
        s.detail = null
        s.active = { kind: 'group', id: group.id }
        s.groupFocus = { kind, name, nonce: Date.now() }
      })
    },
    clearGroupFocus() {
      mutate((s) => { s.groupFocus = null })
    },
    inheritGroup() {
      mutate((s) => {
        const key = scopeKey(s.scope)
        delete s.activeGroup[key]
        s.active = { kind: 'group', id: null }
        s.detail = null
        s.groupFocus = null
        pushToast(s, '已恢复继承（沿用下层配置集）')
      })
      sync({ type: 'group.inherit', scope: getState().scope })
    },
    setNone() {
      mutate((s) => {
        s.activeGroup[scopeKey(s.scope)] = ''
        s.active = { kind: 'group', id: null }
        s.detail = null
        s.groupFocus = null
        pushToast(s, '本层已声明不使用配置集（阻断继承）')
      })
      sync({ type: 'group.none', scope: getState().scope })
    },
    openDetail(detail) { mutate((s) => { s.detail = detail }) },
    closeDetail() { mutate((s) => { s.detail = null }) },
    selectResource(ref) {
      mutate((s) => {
        s.detail = null
        if (ref.kind === 'skill') s.selected.skill = ref
        else if (ref.kind === 'mcp') s.selected.mcp = ref
        else s.selected.prompt = ref
      })
    },
  }
}
