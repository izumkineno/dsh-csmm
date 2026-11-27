import { useAppViewModel } from '../../viewmodel/useAppViewModel'
import { scopeKey } from '../../model/selectors'

/** 资源页顶部的生效配置集条：随时看到当前白名单，并可跳到配置集管理。 */
export default function ActiveGroupBar() {
  const { state, actions, selectors } = useAppViewModel()
  const winner = selectors.winningLayer(state)
  const group = winner.group
  const explicitNone = state.activeGroup[scopeKey(state.scope)] === ''
  const title = group
    ? (winner.inherited ? '继承生效 · ' + group.name : '生效中 · ' + group.name)
    : explicitNone ? '本层不使用配置集' : '无生效配置集'
  const scope = group && winner.inherited ? selectors.scopeTitle(winner.sc, state.meta) : ''
  return (
    <div className="active-group-bar" data-activegroup>
      <span className={'dot ' + (group ? 'on' : 'off')}></span>
      <span className="name" title={scope ? '生效组来自 ' + scope : title}>{title}</span>
      {group && <span className="meta">{group.items.length} 项 · ≈{selectors.groupTokens(group, state).toLocaleString('en-US')} t</span>}
      {group && group.items.length === 0 && <span className="tag" title="空组即白名单：所有提示词段都会被拦截">空组</span>}
      <span className="grow"></span>
      <button className="btn tiny" data-manage-group onClick={() => actions.setTab('manage')}>管理</button>
    </div>
  )
}
