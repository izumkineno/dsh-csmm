import { useEffect, useState } from 'react'
import {
  SCOPE_LABEL,
  type Actions,
  type AppState,
  type BudgetBreakdown,
  type GroupItem,
  type Selectors,
} from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'
import { BudgetCard, ItemRow, buildDiagnostics, buildEffectiveText, previewRow } from './preview/inspector'

function InspectorView() {
  const { state, selectors, actions } = useAppViewModel()
  const [tab, setTab] = useState<'content' | 'diagnostics'>('content')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const toggle = (key: string) => setExpanded((map) => ({ ...map, [key]: !map[key] }))

  const budget = selectors.budgetBreakdown(state)
  const diagnostics = buildDiagnostics(state, selectors, actions)
  const winner = selectors.winningLayer(state)
  const covered = selectors.coveredLayers(state).covered
  const chain = selectors.chainFor(state.scope, state.meta)
  const group = winner.group
  const winnerName = winner.sc.kind === 'global' ? '全局' : SCOPE_LABEL[winner.sc.kind] + ' · ' + selectors.scopeTitle(winner.sc, state.meta)
  const counts = budget.counts

  const copy = () => {
    const text = buildEffectiveText(state, selectors)
    if (!text) { actions.toast('当前没有可复制的生效内容'); return }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      actions.toast('已复制生效内容')
      navigator.clipboard.writeText(text).catch(() => actions.toast('复制失败，请检查剪贴板权限'))
    } else {
      actions.toast('当前环境不支持剪贴板')
    }
  }

  const expandedRow = (key: string) => !!expanded[key]
  const rowToggle = (key: string) => () => toggle(key)

  return (
    <div className="inspector">
      <BudgetCard budget={budget} />

      <div className="inspector-tabs" role="tablist" aria-label="预览视图">
        <button role="tab" aria-selected={tab === 'content'} className={'inspector-tab' + (tab === 'content' ? ' active' : '')}
          onClick={() => setTab('content')}>生效内容 <span className="n" title="本组项数，不含自定义提示词与运行上下文">{group ? group.items.length : 0}</span></button>
        <button role="tab" aria-selected={tab === 'diagnostics'} className={'inspector-tab' + (tab === 'diagnostics' ? ' active' : '')}
          onClick={() => setTab('diagnostics')}>诊断 <span className={'n' + (diagnostics.length ? ' has' : '')}>{diagnostics.length}</span></button>
      </div>

      {tab === 'content' && (
        <div className="inspector-pane" role="tabpanel">
          <div className="chain" aria-label="作用域链">
            {chain.map((scope, index) => {
              const current = selectors.sameScope(scope, winner.sc) && !!group
              return (
                <button type="button" key={index} className={'chain-node' + (current ? ' on' : '')}
                  title={'切换作用域：' + selectors.scopeCrumb(scope, state.meta)}
                  onClick={() => { if (!selectors.sameScope(scope, state.scope)) actions.setScope(scope) }}>
                  {SCOPE_LABEL[scope.kind]}
                  {scope.kind !== 'global' && <small>{selectors.scopeTitle(scope, state.meta)}</small>}
                </button>
              )
            })}
          </div>

          {winner.inherited && group && (
            <div className="note">当前作用域没有自己的生效分组，沿用 {winnerName} 的「{group.name}」。</div>
          )}

          {group ? (
            <div className={'pv-block scope-' + winner.sc.kind}>
              <div className="pv-head">
                <span className="n">✓ {group.name}</span>
                <span className="tag">{SCOPE_LABEL[winner.sc.kind]}</span>
                <span className="muted">≈ {selectors.itemsTokens(group.items, state)} tok</span>
              </div>
              <div className="pv-body">
                <div className="pv-kind">提示词段 <span className="n">{counts.section}</span></div>
                {group.items.filter((item) => item.kind === 'section').map((item, index) => (
                  <ItemRow key={'s:' + item.name + index} it={item} state={state} selectors={selectors}
                    expanded={expandedRow('s:' + item.name)} onToggle={rowToggle('s:' + item.name)} />
                ))}
                {!counts.section && <div className="pv-empty">没有选入提示词段。</div>}

                <div className="pv-kind">技能 <span className="n">{counts.skill}</span></div>
                {group.items.filter((item) => item.kind === 'skill').map((item, index) => (
                  <ItemRow key={'k:' + item.name + index} it={item} state={state} selectors={selectors}
                    expanded={expandedRow('k:' + item.name)} onToggle={rowToggle('k:' + item.name)} />
                ))}
                {!counts.skill && <div className="pv-empty">没有选入技能。</div>}

                <div className="pv-kind">MCP 服务器 <span className="n">{counts.mcp}</span></div>
                {group.items.filter((item) => item.kind === 'mcp').map((item, index) => (
                  <ItemRow key={'m:' + item.name + index} it={item} state={state} selectors={selectors}
                    expanded={expandedRow('m:' + item.name)} onToggle={rowToggle('m:' + item.name)} />
                ))}
                {!counts.mcp && <div className="pv-empty">没有选入 MCP 服务器。</div>}
              </div>
            </div>
          ) : (
            <div className="empty">当前作用域链上还没有生效分组。左侧启用一个分组，或在编辑器里添加资源。</div>
          )}

          {winner.customs.length > 0 && (
            <div className="pv-customs">
              <div className="pv-kind">自定义提示词 <span className="n">{winner.customs.length}</span> <span className="tag">{SCOPE_LABEL[winner.sc.kind]}</span></div>
              {winner.customs.map((custom) => (
                <div key={custom.id} className="pv-block">
                  <div className="pv-head">
                    <span className="n">自定义 · {custom.title}</span>
                    <span className="muted">≈ {selectors.tokenEstimate(custom.text)} tok</span>
                  </div>
                  <div className="pv-body">
                    {previewRow(custom.title, custom.text, selectors.tokenEstimate(custom.text), '自定义',
                      expandedRow('c:' + custom.id), rowToggle('c:' + custom.id), 'cat-custom')}
                  </div>
                </div>
              ))}
            </div>
          )}

          {covered.length > 0 && (
            <details className="pv-covered">
              <summary>被本层覆盖的下层分组 · {covered.length}</summary>
              {covered.map(({ sc, group: coveredGroup }) => (
                <div key={selectors.scopeKey(sc)} className="pv-covered-row">
                  <span>{SCOPE_LABEL[sc.kind]}{sc.kind === 'global' ? '' : ' · ' + selectors.scopeTitle(sc, state.meta)}</span>
                  <span className="muted">{coveredGroup.name} · {coveredGroup.items.length} 项被覆盖</span>
                </div>
              ))}
            </details>
          )}

          <div className="inspector-foot">
            <span className="muted" title="当前生效内容合计：提示词段、技能、MCP、自定义提示词与运行上下文">生效合计 {budget.total.toLocaleString()} tok</span>
            <span className="muted">工具 deny {selectors.denyCountFor(state)}</span>
            <span className="muted">技能遮蔽 {selectors.shadowCountFor(state)}</span>
            <button className="btn small" onClick={copy}>复制生效内容</button>
          </div>
        </div>
      )}

      {tab === 'diagnostics' && (
        <div className="inspector-pane" role="tabpanel">
          {diagnostics.length === 0
            ? <div className="diag-empty"><strong>没有发现问题</strong><span>生效集合、工具状态与预算都在预期范围内。</span></div>
            : diagnostics.map((diag) => (
              <div key={diag.key} className={'diag ' + diag.level}>
                <div className="diag-main">
                  <div className="diag-title"><span className={'diag-dot ' + diag.level} />{diag.title}</div>
                  <div className="diag-detail">{diag.detail}</div>
                </div>
                {diag.action && (
                  <button className="btn tiny" onClick={diag.action.run}>{diag.action.label}</button>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

export default function Preview() {
  const { state, selectors } = useAppViewModel()
  return (
    <>
      <div className="col-head">上下文预览 <span className="tag">{selectors.scopeCrumb(state.scope, state.meta)}</span></div>
      <div className="scroll" id="previewPane">
        <InspectorView />
      </div>
    </>
  )
}
