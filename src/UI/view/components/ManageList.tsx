import type { GroupItemKind } from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

export default function ManageList() {
  const { state, actions, selectors } = useAppViewModel()
  const groups = selectors.groupsOf(state.groups, state.scope, state.meta)
  const activeId = state.activeGroup[selectors.scopeKey(state.scope)]
  const winner = selectors.winningLayer(state)
  const effective = winner.group
  const effectiveLabel = effective
    ? (winner.inherited ? '继承生效：' + effective.name + '（' + selectors.scopeTitle(winner.sc, state.meta) + '）' : '生效中：' + effective.name)
    : activeId === '' ? '本层不使用配置集' : '没有生效配置集'

  return (
    <>
      <div className="list-actions">
        <button className="btn small" onClick={() => actions.newGroup()}>+ 新配置集</button>
      </div>
      <div className="scroll">
        <div className="note" data-manage-state>
          <div><b>{effectiveLabel}</b></div>
          <div className="muted">本页只管配置集与生效；提示词全文在「提示词」页查看。</div>
        </div>
        <div className="effective-row">
          <span className="muted">生效配置集</span>
          <select className="filter-select effective-select" data-effective
            value={activeId === undefined ? '__inherit' : activeId === '' ? '__none' : activeId}
            aria-label="选择当前作用域的生效配置集"
            onChange={(e) => {
              const value = e.target.value
              if (value === '__inherit') actions.inheritGroup()
              else if (value === '__none') actions.setNone()
              else actions.setEffectiveGroup(value)
            }}>
            {state.scope.kind === 'workspace' && <option value="__inherit">继承下层</option>}
            <option value="__none">不使用配置集</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        {state.scope.kind === 'workspace' && (
          <button className={'item-row' + (activeId === undefined ? ' active' : '')} data-none title="删除本层声明，沿用下层的配置集"
            onClick={() => actions.inheritGroup()}>
            <span className="i-ico">↳</span><span className="i-main"><span className="i-name">继承下层</span>
            <span className="i-meta">本层不声明配置集，沿用全局的生效配置集</span></span>
          </button>
        )}
        <button className={'item-row' + (activeId === '' ? ' active' : '')} data-none-explicit title="本层显式声明不使用配置集，阻断继承"
          onClick={() => actions.setNone()}>
          <span className="i-ico">∅</span><span className="i-main"><span className="i-name">不使用配置集</span>
          <span className="i-meta">{state.scope.kind === 'workspace' ? '本层生效内容为空，阻断继承' : '全局不使用任何配置集'}</span></span>
        </button>
        <div className="rail-sec">配置集 <span className="count">{groups.length}</span></div>
        {groups.length === 0 && <div className="sub-empty">该作用域还没有配置集</div>}
        {groups.map((g) => {
          const c: Record<GroupItemKind, number> = { section: 0, mcp: 0, skill: 0, tool: 0 }
          g.items.forEach((it) => { if (c[it.kind] !== undefined) c[it.kind]++ })
          const on = activeId === g.id
          const selected = state.active.kind === 'group' && state.active.id === g.id
          return (
            <div key={g.id} className={'item-row' + (selected ? ' active' : '')} data-item="group" data-id={g.id}
              role="button" tabIndex={0} aria-pressed={selected}
              onClick={() => actions.setActive('group', g.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.setActive('group', g.id) }
              }}>
              <span className="i-ico">▦</span>
              <span className="i-main"><span className="i-name">{g.name}</span>
                <span className="i-meta">{g.items.length} 项 · ≈{selectors.groupTokens(g, state).toLocaleString('en-US')} t · {c.section} 段 / {c.tool} 工具 / {c.skill} 技能 / {c.mcp} MCP</span></span>
              <span className="i-tail">
                {g.items.length === 0 && <span className="tag" title="配置集存在但没有任何条目">空</span>}
                {on
                  ? <span className="i-on" title="当前作用域正在生效的配置集">生效中</span>
                  : (selected ? <span className="i-off" title="正在编辑，尚未生效">编辑中</span> : null)}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}
