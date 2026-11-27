import type { ReactElement } from 'react'
import { SCOPE_LABEL, type Actions, type AppState, type BudgetBreakdown, type Group, type GroupItem, type Selectors } from '../../../contracts'

// 参考预算：主流 200K 上下文窗口的保守估算值，仅用于提示，不代表宿主真实上限。
export const CONTEXT_BUDGET = 200_000

function formatWindow(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M'
  return Math.round(n / 1_000) + 'K'
}

const SEGMENTS: Array<{
  key: 'context' | 'section' | 'skill' | 'mcp' | 'tool' | 'custom'
  label: string
}> = [
  { key: 'context', label: '上下文' },
  { key: 'section', label: '提示词段' },
  { key: 'skill', label: '技能' },
  { key: 'mcp', label: 'MCP' },
  { key: 'tool', label: '工具定义' },
  { key: 'custom', label: '自定义' },
]

export interface Diagnostic {
  key: string
  level: 'error' | 'warn' | 'info'
  title: string
  detail: string
  action?: { label: string; run: () => void }
}

export function previewRow(
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

export function BudgetCard({ budget, contextWindow }: { budget: BudgetBreakdown; contextWindow: number }) {
  const pct = (budget.total / contextWindow) * 100
  const level = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok'
  return (
    <section className={'budget-card ' + level} aria-label="上下文预算">
      <div className="budget-head">
        <span className="budget-title">上下文预算</span>
        <span className="budget-num"><strong>{budget.total.toLocaleString()}</strong> / {formatWindow(contextWindow)} tok</span>
      </div>
      <div className="budget-bar" role="img" aria-label={'生效内容构成占比，共 ' + budget.total + ' tok'}>
        {SEGMENTS.map((seg) => {
          const value = budget[seg.key]
          if (!value) return null
          return <span key={seg.key} className={'budget-seg ' + seg.key} style={{ width: (value / contextWindow) * 100 + '%' }} title={seg.label + ' ' + value + ' tok'} />
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

export function ItemRow(props: {
  it: GroupItem
  state: AppState
  selectors: Selectors
  expanded: boolean
  onToggle: () => void
}) {
  const { it, state, selectors, expanded, onToggle } = props
  if (it.kind === 'section') {
    const section = state.meta.sections.find((x) => x.name === it.name)
    const dsh = state.dshPrompts.find((x) => x.name === it.name)
    return previewRow(
      it.name,
      section ? section.text : dsh ? dsh.text : '',
      section ? section.tokens : dsh ? dsh.tokens : 0,
      section ? section.source : dsh ? 'DSH' : '提示词段',
      expanded,
      onToggle,
      'cat-section',
    )
  }
  if (it.kind === 'skill') {
    const skill = selectors.resolvedSkill(state, it.name)
    const off = !!skill && !selectors.effSkillEnabled(state, skill.name)
    const meta = !skill ? '缺失' : off ? '已停用 · 不计入预算' : skill.model ? '模型可调用' : '仅用户可用'
    return previewRow(it.name, skill ? skill.text : '', skill ? selectors.tokenEstimate(skill.text) : 0, meta, expanded, onToggle, off || !skill ? 'off' : 'cat-skill')
  }
  if (it.kind === 'tool') {
    const tool = state.dshPrompts.find(
      (entry) => entry.kind === 'tool' && entry.name === 'tool-schema:' + it.name,
    )
    return previewRow(
      it.name,
      tool ? tool.text : '',
      tool ? tool.tokens : 0,
      '工具定义',
      expanded,
      onToggle,
      tool ? 'cat-tool' : 'off',
    )
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

export function buildEffectiveText(state: AppState, selectors: Selectors, groupOverride?: Group | null): string {
  const winner = selectors.winningLayer(state)
  const group = groupOverride === undefined ? winner.group : groupOverride
  const lines: string[] = []
  const dshContexts = state.dshPrompts.filter((entry) => entry.kind === 'context')
  const contexts: Array<{ name: string; text: string }> = dshContexts.length
    ? dshContexts
    : state.meta.sections.filter((section) => section.kind === 'context')
  if (contexts.length) {
    lines.push('# 运行上下文')
    for (const section of contexts) lines.push('\n## ' + section.name + '\n' + section.text)
  }
  if (group) {
    lines.push('# 配置集：' + group.name)
    for (const item of group.items) {
      if (item.kind === 'section') {
        const section = state.meta.sections.find((x) => x.name === item.name)
        const dsh = section ? undefined : state.dshPrompts.find((x) => x.name === item.name)
        if (section) lines.push('\n## ' + section.name + '（' + section.source + '）\n' + section.text)
        else if (dsh) lines.push('\n## ' + dsh.name + '（DSH）\n' + dsh.text)
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
  const customs = groupOverride === undefined
    ? winner.customs
    : group
      ? selectors.customsOf(state.customs, group.scope, state.meta).filter((custom) => custom.enabled !== false)
      : []
  for (const custom of customs) lines.push('\n## 自定义：' + custom.title + '\n' + custom.text)
  return lines.join('\n')
}

export function buildDiagnostics(state: AppState, selectors: Selectors, actions: Actions): Diagnostic[] {
  const out: Diagnostic[] = []
  const winner = selectors.winningLayer(state)
  const budget = selectors.budgetBreakdown(state)
  const pct = (budget.total / CONTEXT_BUDGET) * 100
  const group = winner.group

  if (!group) {
    out.push({
      key: 'empty-chain',
      level: 'info',
      title: '当前作用域链没有生效配置集',
      detail: '这里只展示本层已启用的自定义提示词。在左栏选择一个配置集并点「设为生效」后，会显示完整的注入内容。',
    })
  }
  if (group && group.items.length === 0) {
    out.push({
      key: 'empty-group',
      level: 'warn',
      title: '生效配置集是空组',
      detail: '空组不会注入任何资源，模型只能看到自定义提示词。',
      action: { label: '编辑配置集', run: () => { actions.setTab('manage'); actions.setActive('group', group.id) } },
    })
  }
  if (group && group.items.length > 0 && !group.items.some((item) => item.kind === 'section')) {
    out.push({
      key: 'no-sections',
      level: 'info',
      title: '本组没有包含提示词段',
      detail: '生效的系统提示词将为空，只加载技能、MCP 与自定义提示词。确认这是预期行为。',
      action: { label: '编辑配置集', run: () => { actions.setTab('manage'); actions.setActive('group', group.id) } },
    })
  }
  if (group) {
    for (const item of group.items) {
      if (item.kind === 'section' && !state.meta.sections.some((x) => x.name === item.name)) {
        out.push({ key: 'missing-section:' + item.name, level: 'error', title: '配置集引用了不存在的提示词段', detail: item.name + ' 当前不可用，不会注入。' })
      }
      if (item.kind === 'skill' && !selectors.resolvedSkill(state, item.name)) {
        out.push({ key: 'missing-skill:' + item.name, level: 'error', title: '配置集引用了不存在的技能', detail: item.name + ' 当前不可用，不会注入。' })
      }
      if (item.kind === 'mcp' && !selectors.resolvedServer(state, item.name)) {
        out.push({ key: 'missing-mcp:' + item.name, level: 'error', title: '配置集引用了不存在的 MCP 服务器', detail: item.name + ' 当前不可用，不会注入。' })
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
        title: '配置集内部分 MCP 服务器已停用',
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
        title: '配置集内部分技能已停用',
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
        title: '配置集内 MCP 服务器未连接',
        detail: downServers.map((server) => server.name).join('、') + ' 当前不可用，相关工具会缺席。',
        action: { label: '查看 MCP', run: () => { actions.setTab('mcp'); actions.selectResource({ kind: 'mcp', name: downServers[0].name }) } },
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
      title: '有技能被配置集遮蔽',
      detail: shadow + ' 个可见技能不在生效配置集中，因此不会进入提示词。',
      action: { label: '查看技能', run: () => actions.setTab('skill') },
    })
  }
  const covered = selectors.coveredLayers(state).covered
  if (covered.length > 0) {
    out.push({
      key: 'covered',
      level: 'info',
      title: '下层配置集被本层覆盖',
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
      detail: '估算占用 ' + budget.total.toLocaleString() + ' tok（' + Math.round(pct) + '%）。建议减少技能或拆分配置集，优先保留高信号内容。',
    })
  }
  return out
}

