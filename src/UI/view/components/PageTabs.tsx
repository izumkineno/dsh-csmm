import { PAGE_TABS } from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

export default function PageTabs() {
  const { state, actions, selectors } = useAppViewModel()
  return (
    <nav className="page-tabs" id="pageTabs" aria-label="页面">
      {PAGE_TABS.map((t) => {
        const n = t.id === 'prompt'
          ? selectors.groupsOf(state.groups, state.scope).length + selectors.customsOf(state.customs, state.scope).length
          : t.id === 'skill'
            ? state.skills.filter((s) => selectors.skillVisible(s, state.scope, state.meta)).length
            : state.servers.length
        return (
          <button key={t.id} className={'page-tab' + (state.tab === t.id ? ' active' : '')}
            data-tab={t.id} onClick={() => actions.setTab(t.id)}>
            {t.label}<span className="n">{n}</span>
          </button>
        )
      })}
    </nav>
  )
}
