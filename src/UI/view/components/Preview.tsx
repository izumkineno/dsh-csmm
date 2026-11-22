import { useState, type ReactElement } from 'react'
import { SCOPE_LABEL, type AppState, type GroupItem, type Selectors } from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

function previewRow(
  name: string,
  text: string,
  tokens: number,
  meta: string | undefined,
  expanded: boolean,
  onToggle: () => void,
): ReactElement {
  const body = text || '（空）'
  const long = body.length > 400
  const shown = !long || expanded ? body : body.slice(0, 400) + '…'
  return (
    <div className="pv-row">
      <div className="pv-row-head"><strong>{name}</strong><span className="muted">{tokens} tok</span>{meta && <span className="tag">{meta}</span>}</div>
      <div className={'pv-row-text' + (expanded ? ' full' : '')}>{shown}</div>
      {long && <button className="linkbtn" onClick={onToggle}>{expanded ? '收起' : '展开全文（' + body.length + ' 字）'}</button>}
    </div>
  )
}

function itemRow(
  it: GroupItem,
  state: AppState,
  selectors: Selectors,
  expanded: boolean,
  onToggle: () => void,
): ReactElement {
  if (it.kind === 'section') {
    const s = state.meta.sections.find((x) => x.name === it.name)
    return previewRow(it.name, s ? s.text : '', s ? s.tokens : 0, s ? s.source : '提示词段', expanded, onToggle)
  }
  if (it.kind === 'mcp') {
    const srv = state.servers.find((x) => x.name === it.name)
    if (!srv) return previewRow('mcp:' + it.name, '', 0, 'MCP', expanded, onToggle)
    const srvOff = !selectors.effServerEnabled(state, srv.name)
    return (
      <>
        {previewRow('mcp:' + srv.name, srv.instructions, srv.tokens, srvOff ? '已停用' : srv.transport, expanded, onToggle)}
        {srv.tools.map((t) => (
          <div key={t.name} className="pv-row tool">
            <div className="pv-row-head">
              <input type="checkbox" checked={selectors.effToolOn(state, srv.name, t.name)} disabled readOnly aria-label={t.name} />
              <strong>mcp__{srv.name}__{t.name}</strong>
              <span className="tag">{selectors.effToolOn(state, srv.name, t.name) ? '启用' : '已 deny'}</span>
            </div>
          </div>
        ))}
      </>
    )
  }
  const sk = state.skills.find((x) => x.name === it.name)
  const skOff = sk && !selectors.effSkillEnabled(state, sk.name)
  return previewRow(
    it.name,
    sk ? sk.text : '',
    sk ? selectors.tokenEstimate(sk.text) : 0,
    !sk ? '仅用户可用' : skOff ? '已停用' : sk.model ? '模型可调用' : '仅用户可用',
    expanded,
    onToggle,
  )
}

function PreviewView() {
  const { state, selectors } = useAppViewModel()
  const { winner: w, covered } = selectors.coveredLayers(state)
  const total = selectors.mergedTotal(state)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const toggle = (k: string) => setExpanded((e) => ({ ...e, [k]: !e[k] }))
  const g = w.group
  const wName = w.sc.kind === 'global' ? '全局' : SCOPE_LABEL[w.sc.kind] + ' · ' + selectors.scopeTitle(w.sc, state.meta)
  return (
    <>
      {w.inherited && g && <div className="note">当前{SCOPE_LABEL[state.scope.kind]}未设分组，继承{wName}的「{g.name}」</div>}
      {g && (
        <div>
          <div className="group-label">生效层 · {wName}</div>
          <div className={'pv-block scope-' + w.sc.kind}>
            <div className="pv-head"><span className="n">✓</span><span className="lvl">{SCOPE_LABEL[w.sc.kind]} · {g.name}</span>
              <span className="muted">≈ {selectors.itemsTokens(g.items, state)} tok</span></div>
            <div className="pv-body">
              {g.items.map((it, i) => {
                const k = selectors.scopeKey(w.sc) + ':' + g.id + ':' + i
                return <div key={i}>{itemRow(it, state, selectors, !!expanded[k], () => toggle(k))}</div>
              })}
            </div>
          </div>
        </div>
      )}
      {!g && !w.customs.length && <div className="empty">当前作用域链上还没有生效内容。左侧启用一个分组，或在编辑器里添加资源。</div>}
      {w.customs.map((c) => (
        <div key={c.id} className="pv-block">
          <div className="pv-head">自定义 · {c.title}<span className="muted">≈ {selectors.tokenEstimate(c.text)} tok</span></div>
          <div className="pv-body">
            {previewRow(c.title, c.text, selectors.tokenEstimate(c.text), '自定义', !!expanded['custom:' + c.id], () => toggle('custom:' + c.id))}
          </div>
        </div>
      ))}
      {covered.map(({ sc, group }) => (
        <div key={'cov:' + selectors.scopeKey(sc)} className="note" title={group.items.map((it) => it.name).join('、')}>
          {SCOPE_LABEL[sc.kind]}{sc.kind === 'global' ? '' : ' · ' + selectors.scopeTitle(sc, state.meta)}「{group.name}」{group.items.length} 项被{w.sc.kind === 'global' ? '全局' : SCOPE_LABEL[w.sc.kind]}覆盖
        </div>
      ))}
      <div className="pv-total">
        <div className="pv-total-line">合计 <strong>{total} tok</strong>（估算）</div>
        <div className="pv-counts">
          <span>工具 deny <strong>{selectors.denyCountFor(state)}</strong></span>
          <span>技能遮蔽 <strong>{selectors.shadowCountFor(state)}</strong></span>
          <span>MCP 服务器 <strong>{state.servers.length}</strong></span>
        </div>
      </div>
    </>
  )
}

export default function Preview() {
  const { state, selectors } = useAppViewModel()
  return (
    <>
      <div className="col-head">生效预览 <span className="tag">{selectors.scopeCrumb(state.scope, state.meta)}</span></div>
      <div className="scroll" id="previewPane">
        <PreviewView />
      </div>
    </>
  )
}
