import { useState, type ReactElement } from 'react'
import {
  SCOPE_LABEL,
  type Actions,
  type AppState,
  type BudgetBreakdown,
  type GroupItem,
  type Selectors,
} from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

// 参考预算：主流 200K 上下文窗口的保守估算值，仅用于提示，不代表宿主真实上限。
const CONTEXT_BUDGET = 200_000

const SEGMENTS: Array<{ key: 'context' | 'section' | 'skill' | 'mcp' | 'custom'; label: string }> = [
  { key: 'context', label: '上下文' },
  { key: 'section', label: '提示词段' },
  { key: 'skill', label: '技能' },
  { key: 'mcp', label: 'MCP' },
  { key: 'custom', label: '自定义' },
]

interface Diagnostic {
  key: string
  level: 'error' | 'warn' | 'info'
  title: string
  detail: string
  action?: { label: string; run: () => void }
}

function previewRow(
  name: string,
  text: string,
  tokens: number,
  meta: string | undefined,
  expanded: boolean,
  onToggle: () => void,
  tagClass?: string,
): ReactElement {
  const body = text || '（空）'
  const long = body.length > 400
  const shown = !long || expanded ? body : body.slice(0, 400) + '…'
  return (
    <div className="pv-row">
      <div className="pv-row-head">
        <strong>{name}</strong>
        <span className="muted">{tokens} tok</span>
        {meta && <span className={'tag' + (tagClass ? ' ' + tagClass : '')}>{meta}</span>}
      </div>
      <div className={'pv-row-text' + (expanded ? ' full' : '')}>{shown}</div>
      {long && <button className="linkbtn" onClick={onToggle}>{expanded ? '收起' : '展开全文（' + body.length + ' 字）'}</button>}
    </div>
  )
}

function BudgetCard({ budget }: { budget: BudgetBreakdown }) {
  const pct = (budget.total / CONTEXT_BUDGET) * 100
  const level = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok'
  return (
    <section className={'budget-card ' + level} aria-label="上下文预算">
      <div className="budget-head">
        <span className="budget-title">上下文预算</span>
        <span className="budget-num"><strong>{budget.total.toLocaleString()}</strong> / {Math.round(CONTEXT_BUDGET / 1000)}K tok</span>
      </div>
      <div className="budget-bar" role="img" aria-label={'生效内容构成占比，共 ' + budget.total + ' tok'}>
        {SEGMENTS.map((seg) => {
          const value = budget[seg.key]
          if (!value) return null
          return <span key={seg.key} className={'budget-seg ' + seg.key} style={{ width: (value / CONTEXT_BUDGET) * 100 + '%' }} title={seg.label + ' ' + value + ' tok'} />
        })}
        {budget.total === 0 && <span className="budget-seg empty" style={{ width: '100%' }} />}
        <span className="budget-mark" style={{ left: '70%' }} title="70% 警戒线" />
        <span className="budget-mark danger" style={{ left: '90%' }} title="90% 危险线" />
      </div>
      <div className="budget-legend">
        {SEGMENTS.map((seg) => (
          <span key={seg.key} className={'budget-legend-item' + (budget[seg.key] ? '' : ' zero')}>
            <i className={'budget-dot ' + seg.key} />{seg.label} <b>{budget[seg.key].toLocaleString()}</b>
          </span>
        ))}
      </div>
      <div className="budget-foot">
        <span>{pct > 0 && pct < 1 ? '<1' : Math.round(pct)}% 预算 · 估算</span>
        <span className={'budget-state ' + level}>
          {level === 'ok' ? '余量充足' : level === 'warn' ? '接近 70% 警戒线' : '超过 90%，建议拆分'}
        </span>
      </div>
    </section>
  )
}

function ItemRow(props: {
  it: GroupItem
  state: AppState
  selectors: Selectors
  expanded: boolean
  onToggle: () => void
}) {
  const { it, state, selectors, expanded, onToggle } = props
  if (it.kind === 'section') {
    const section = state.meta.sections.find((x) => x.name === it.name)
    return previewRow(it.name, section ? section.text : '', section ? section.tokens : 0, section ? section.source : '提示词段', expanded, onToggle, 'cat-section')
  }
  if (it.kind === 'skill') {
    const skill = selectors.resolvedSkill(state, it.name)
    const off = !!skill && !selectors.effSkillEnabled(state, skill.name)
    const meta = !skill ? '缺失' : off ? '已停用 · 不计入预算' : skill.model ? '模型可调用' : '仅用户可用'
    return previewRow(it.name, skill ? skill.text : '', skill ? selectors.tokenEstimate(skill.text) : 0, meta, expanded, onToggle, off || !skill ? 'off' : 'cat-skill')
  }
  const server = selectors.resolvedServer(state, it.name)
  if (!server) return previewRow('mcp:' + it.name, '', 0, '缺失', expanded, onToggle, 'off')
  const serverOff = !selectors.effServerEnabled(state, server.name)
  const deny = server.tools.filter((tool) => !selectors.effToolOn(state, server.name, tool.name)).length
  return (
    <div className="pv-mcp">
      {previewRow('mcp:' + server.name, server.instructions, server.tokens, serverOff ? '已停用' : server.transport, expanded, onToggle, serverOff ? 'off' : 'cat-mcp')}
      <details className="pv-tools">
        <summary>{server.tools.length} 个工具 · {deny ? deny + ' 个 deny' : '全部可用'}</summary>
        {server.tools.map((tool) => {
          const on = selectors.effToolOn(state, server.name, tool.name)
          return (
            <div key={tool.name} className="pv-tool-row">
              <input type="checkbox" checked={on} disabled readOnly aria-label={tool.name} />
              <span className="pv-tool-name">mcp__{server.name}__{tool.name}</span>
              <span className={'tag' + (on ? '' : ' off')}>{on ? '启用' : '已 deny'}</span>
            </div>
          )
        })}
      </details>
    </div>
  )
}

function buildEffectiveText(state: AppState, selectors: Selectors): string {
  const winner = selectors.winningLayer(state)
  const lines: string[] = []
  const contexts = state.meta.sections.filter((section) => section.kind === 'context')
  if (contexts.length) {
    lines.push('# 运行上下文')
    for (const section of contexts) lines.push('\n## ' + section.name + '\n' + section.text)
  }
  if (winner.group) {
    lines.push('# 生效分组：' + winner.group.name)
    for (const item of winner.group.items) {
      if (item.kind === 'section') {
        const section = state.meta.sections.find((x) => x.name === item.name)
        if (section) lines.push('\n## ' + section.name + '（' + section.source + '）\n' + section.text)
      }
      if (item.kind === 'skill') {
        const skill = selectors.resolvedSkill(state, item.name)
        if (skill && selectors.effSkillEnabled(state, skill.name)) lines.push('\n## 技能：' + skill.name + '\n' + skill.text)
      }
      if (item.kind === 'mcp') {
        const server = selectors.resolvedServer(state, item.name)
        if (server && selectors.effServerEnabled(state, server.name)) lines.push('\n## MCP：' + server.name + '\n' + server.instructions)
      }
    }
  }
  for (const custom of winner.customs) lines.push('\n## 自定义：' + custom.title + '\n' + custom.text)
  return lines.join('\n')
}

function buildDiagnostics(state: AppState, selectors: Selectors, actions: Actions): Diagnostic[] {
  const out: Diagnostic[] = []
  const winner = selectors.winningLayer(state)
  const budget = selectors.budgetBreakdown(state)
  const pct = (budget.total / CONTEXT_BUDGET) * 100
  const group = winner.group

  if (!group) {
    out.push({
      key: 'empty-chain',
      level: 'info',
      title: '当前作用域链没有生效分组',
      detail: '这里只展示本层自定义提示词。在左栏选择一个分组并点「设为生效」后，会显示完整的注入内容。',
    })
  }
  if (group && group.items.length === 0) {
    out.push({
      key: 'empty-group',
      level: 'warn',
      title: '生效分组是空组',
      detail: '空组不会注入任何资源，模型只能看到自定义提示词。',
      action: { label: '编辑分组', run: () => actions.setActive('group', group.id) },
    })
  }
  if (group && group.items.length > 0 && !group.items.some((item) => item.kind === 'section')) {
    out.push({
      key: 'no-sections',
      level: 'info',
      title: '本组没有包含提示词段',
      detail: '生效的系统提示词将为空，只加载技能、MCP 与自定义提示词。确认这是预期行为。',
      action: { label: '编辑分组', run: () => actions.setActive('group', group.id) },
    })
  }
  if (group) {
    for (const item of group.items) {
      if (item.kind === 'section' && !state.meta.sections.some((x) => x.name === item.name)) {
        out.push({ key: 'missing-section:' + item.name, level: 'error', title: '分组引用了不存在的提示词段', detail: item.name + ' 当前不可用，不会注入。' })
      }
      if (item.kind === 'skill' && !selectors.resolvedSkill(state, item.name)) {
        out.push({ key: 'missing-skill:' + item.name, level: 'error', title: '分组引用了不存在的技能', detail: item.name + ' 当前不可用，不会注入。' })
      }
      if (item.kind === 'mcp' && !selectors.resolvedServer(state, item.name)) {
        out.push({ key: 'missing-mcp:' + item.name, level: 'error', title: '分组引用了不存在的 MCP 服务器', detail: item.name + ' 当前不可用，不会注入。' })
      }
    }
    const offServers = group.items
      .filter((item) => item.kind === 'mcp')
      .map((item) => selectors.resolvedServer(state, item.name))
      .filter((server): server is NonNullable<typeof server> => !!server && !selectors.effServerEnabled(state, server.name))
    if (offServers.length) {
      out.push({
        key: 'off-servers',
        level: 'warn',
        title: '分组内部分 MCP 服务器已停用',
        detail: offServers.map((server) => server.name).join('、') + ' 不会向模型提供工具。',
        action: { label: '去 MCP', run: () => actions.setTab('mcp') },
      })
    }
    const offSkills = group.items
      .filter((item) => item.kind === 'skill')
      .map((item) => selectors.resolvedSkill(state, item.name))
      .filter((skill): skill is NonNullable<typeof skill> => !!skill && !selectors.effSkillEnabled(state, skill.name))
    if (offSkills.length) {
      out.push({
        key: 'off-skills',
        level: 'info',
        title: '分组内部分技能已停用',
        detail: offSkills.map((skill) => skill.name).join('、') + ' 在生效集合中但当前不会加载。',
        action: { label: '去技能', run: () => actions.setTab('skill') },
      })
    }
    const downServers = group.items
      .filter((item) => item.kind === 'mcp')
      .map((item) => selectors.resolvedServer(state, item.name))
      .filter((server): server is NonNullable<typeof server> => !!server && server.status !== 'connected')
    if (downServers.length) {
      out.push({
        key: 'down-servers',
        level: 'warn',
        title: '分组内 MCP 服务器未连接',
        detail: downServers.map((server) => server.name).join('、') + ' 当前不可用，相关工具会缺席。',
        action: { label: '查看 MCP', run: () => actions.openDetail({ kind: 'mcp', name: downServers[0].name }) },
      })
    }
  }

  const deny = selectors.denyCountFor(state)
  if (deny > 0) {
    out.push({
      key: 'deny',
      level: 'warn',
      title: '有工具被 deny',
      detail: '生效集合中有 ' + deny + ' 个工具当前不可用。',
      action: { label: '查看工具', run: () => actions.setTab('mcp') },
    })
  }
  const shadow = selectors.shadowCountFor(state)
  if (shadow > 0) {
    out.push({
      key: 'shadow',
      level: 'info',
      title: '有技能被分组遮蔽',
      detail: shadow + ' 个可见技能不在生效分组中，因此不会进入提示词。',
      action: { label: '查看技能', run: () => actions.setTab('skill') },
    })
  }
  const covered = selectors.coveredLayers(state).covered
  if (covered.length > 0) {
    out.push({
      key: 'covered',
      level: 'info',
      title: '下层分组被本层覆盖',
      detail: covered
        .map(({ sc, group }) => SCOPE_LABEL[sc.kind] + (sc.kind === 'global' ? '' : ' · ' + selectors.scopeTitle(sc, state.meta)) + '「' + group.name + '」')
        .join('；'),
    })
  }
  if (pct >= 70) {
    out.push({
      key: 'budget',
      level: pct >= 90 ? 'error' : 'warn',
      title: '上下文预算偏紧',
      detail: '估算占用 ' + budget.total.toLocaleString() + ' tok（' + Math.round(pct) + '%）。建议减少技能或拆分分组，优先保留高信号内容。',
    })
  }
  return out
}

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
          onClick={() => setTab('content')}>生效内容 <span className="n">{group ? group.items.length : 0}</span></button>
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
            <span className="muted">合计 {budget.total.toLocaleString()} tok</span>
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
