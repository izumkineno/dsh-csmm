import { useAppViewModel } from '../../viewmodel/useAppViewModel'

export default function ScopeRail() {
  const { state, actions } = useAppViewModel()
  const { workspaces } = state.meta
  const countOf = (kind: 'global' | 'workspace', id?: string): number =>
    state.groups.filter((g) => g.scope.kind === kind && (id === undefined || g.scope.id === id)).length +
    state.customs.filter((c) => c.scope.kind === kind && (id === undefined || c.scope.id === id)).length
  return (
    <>
      <button className={'scope-item' + (state.scope.kind === 'global' ? ' active' : '')}
        data-scope="global" aria-current={state.scope.kind === 'global' ? 'true' : undefined}
        onClick={() => actions.setScope({ kind: 'global', id: null })}>
        <span className="ico">◍</span><span className="label">全局<small>所有工作区都生效</small></span>
        <span className="badge">{countOf('global')}</span>
      </button>
      <div className="rail-sec">工作区 <span className="count">{workspaces.length}</span></div>
      {workspaces.map((w) => {
        const wActive = state.scope.kind === 'workspace' && state.scope.id === w.id
        return (
          <button key={w.id} className={'scope-item' + (wActive ? ' active' : '')}
            data-scope="workspace" data-id={w.id} title={w.path}
            aria-current={wActive ? 'true' : undefined}
            onClick={() => actions.setScope({ kind: 'workspace', id: w.id })}>
            <span className="ico">▤</span><span className="label">{w.title}<small>{w.path}</small></span>
            <span className="badge">{countOf('workspace', w.id)}</span>
          </button>
        )
      })}
    </>
  )
}
