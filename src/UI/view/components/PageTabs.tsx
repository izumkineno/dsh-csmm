import { PAGE_TABS } from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

export default function PageTabs() {
  const { state, actions, selectors } = useAppViewModel()
  const catalog = selectors.promptCatalog(state)
  const customCount = selectors.customsOf(state.customs, state.scope, state.meta).length
  const groupCount = selectors.groupsOf(state.groups, state.scope, state.meta).length
  return (
    <nav className="page-tabs" id="pageTabs" role="tablist" aria-label="页面">
      {PAGE_TABS.map((t) => {
        const n = t.id === 'prompt'
          ? catalog.sections.length + catalog.contexts.length + catalog.tools.length + customCount
          : t.id === 'skill'
            ? selectors.visibleSkills(state).length
            : t.id === 'mcp'
              ? selectors.visibleServers(state).length
              : groupCount
        const selected = state.tab === t.id
        return (
          <button key={t.id} className={'page-tab' + (selected ? ' active' : '')} role="tab"
            aria-selected={selected} data-tab={t.id} onClick={() => actions.setTab(t.id)}>
            {t.label}<span className="n">{n}</span>
          </button>
        )
      })}
    </nav>
  )
}
