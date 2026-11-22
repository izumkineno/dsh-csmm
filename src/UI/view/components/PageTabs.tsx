import { PAGE_TABS } from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

export default function PageTabs() {
  const { state, actions, selectors } = useAppViewModel()
  return (
    <nav className="page-tabs" id="pageTabs" role="tablist" aria-label="页面">
      {PAGE_TABS.map((t) => {
        const n = t.id === 'prompt'
          ? selectors.groupsOf(state.groups, state.scope, state.meta).length + selectors.customsOf(state.customs, state.scope, state.meta).length
          : t.id === 'skill'
            ? selectors.visibleSkills(state).length
            : selectors.visibleServers(state).length
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
