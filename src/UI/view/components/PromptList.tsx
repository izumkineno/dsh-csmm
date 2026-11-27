import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'
import GroupStatus from './GroupStatus'

type CatalogKind = 'section' | 'context' | 'tool'
type Filter = 'all' | 'custom' | CatalogKind

export default function PromptList() {
  const { state, actions, selectors } = useAppViewModel()
  const groups = selectors.groupsOf(state.groups, state.scope, state.meta)
  const customs = selectors.customsOf(state.customs, state.scope, state.meta)
  const catalog = selectors.promptCatalog(state)
  const selected = state.selected.prompt
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const needle = query.trim().toLowerCase()
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle)
  const show = (kind: Filter) => filter === 'all' || filter === kind

  const catalogRow = (kind: CatalogKind, entry: { name: string; source: string; tokens: number }) => {
    const active = selected?.kind === kind && selected.name === entry.name
    return (
      <div key={kind + ':' + entry.name} className={'item-row' + (active ? ' active' : '')}
        data-promptitem data-kind={kind} data-name={entry.name} role="button" tabIndex={0} aria-pressed={active}
        aria-label={'查看' + (kind === 'context' ? '运行上下文 ' : kind === 'tool' ? '工具定义 ' : '提示词段 ') + entry.name}
        onClick={() => actions.selectResource({ kind, name: entry.name })}
        onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.selectResource({ kind, name: entry.name }) }
        }}>
        <span className="i-ico">{kind === 'context' ? '◷' : kind === 'tool' ? '⚙' : '¶'}</span>
        <span className="i-main">
          <span className="i-name">{entry.name}</span>
          <span className="i-meta">{entry.source} · {entry.tokens.toLocaleString('en-US')} t</span>
        </span>
        <span className="i-tail">
          <GroupStatus kind={kind} name={entry.name} />
          {active && <span className="i-off">查看中</span>}
        </span>
      </div>
    )
  }

  return (
    <>
      <div className="list-actions">
        <button className="btn small" onClick={() => actions.newCustom()}>+ 新自定义</button>
        <button className="btn small" disabled={state.dshPromptsState === 'loading'} onClick={() => actions.loadDshPrompts()}>刷新宿主</button>
      </div>
      <div className="list-actions row2">
        <input className="search" data-promptsearch placeholder="搜索提示词…" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="搜索提示词" />
        <select className="filter-select" data-promptfilter value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)} aria-label="按类型筛选">
          <option value="all">全部类型</option>
          <option value="custom">自定义</option>
          <option value="section">提示词段</option>
          <option value="context">运行上下文</option>
          <option value="tool">工具定义</option>
        </select>
      </div>
      <div className="scroll">
        {show('custom') && (
          <>
            <div className="rail-sec">自定义提示词 <span className="count">{customs.length}</span></div>
            {customs.length === 0 && <div className="sub-empty">该作用域还没有自定义提示词</div>}
            {customs.filter((c) => matches(c.title)).map((c) => {
              const active = selected?.kind === 'custom' && selected.id === c.id
              const on = c.enabled !== false
              return (
                <div key={c.id} className={'item-row' + (active ? ' active' : '')}
                  data-item="custom" data-customitem data-id={c.id} role="button" tabIndex={0} aria-pressed={active}
                  onClick={() => actions.selectResource({ kind: 'custom', id: c.id })}
                  onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.selectResource({ kind: 'custom', id: c.id }) }
                  }}>
                  <input type="checkbox" className="custom-check" data-customcheck checked={on}
                    aria-label={(on ? '停用自定义提示词 ' : '启用自定义提示词 ') + c.title}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => actions.toggleCustom(c.id)} />
                  <span className="i-ico">✎</span>
                  <span className="i-main"><span className="i-name">{c.title}</span>
                    <span className="i-meta">{on ? c.text.length + ' 字 · 追加到生效正文末尾' : '不进入生效内容与预算'}</span></span>
                  <span className="i-tail">
                    {active && <span className="i-off">编辑中</span>}
                    {!on && <span className="i-off">已停用</span>}
                  </span>
                </div>
              )
            })}
          </>
        )}

        {show('section') && (
          <>
            <div className="rail-sec">提示词段 <span className="count">{catalog.sections.length}</span></div>
            {state.dshPromptsState === 'loading' && <div className="sub-empty">正在读取宿主注册提示词…</div>}
            {state.dshPromptsState === 'error' && <div className="sub-empty">宿主提示词读取失败：{state.dshPromptsError || '未知错误'}</div>}
            {catalog.sections.filter((entry) => matches(entry.name)).map((entry) => catalogRow('section', entry))}
            {catalog.sections.length === 0 && state.dshPromptsState !== 'loading' && (
              <div className="sub-empty">宿主没有返回提示词段</div>
            )}
          </>
        )}

        {show('context') && (
          <>
            <div className="rail-sec">运行上下文 <span className="count">{catalog.contexts.length}</span></div>
            {catalog.contexts.filter((entry) => matches(entry.name)).map((entry) => catalogRow('context', entry))}
            {catalog.contexts.length === 0 && <div className="sub-empty">宿主没有返回运行上下文</div>}
          </>
        )}

        {show('tool') && (
          <>
            <div className="rail-sec">工具定义 <span className="count">{catalog.tools.length}</span></div>
            {catalog.tools.filter((entry) => matches(entry.name)).map((entry) => catalogRow('tool', entry))}
            {catalog.tools.length === 0 && <div className="sub-empty">宿主没有返回工具定义</div>}
          </>
        )}

        <div className="note" style={{ marginTop: 12 }}>
          点击行在中栏查看全文；行尾只显示成员状态。提示词段与工具是否加入配置集，请到「配置集与生效」页编辑；运行上下文始终注入、不参与配置集。
        </div>
        {groups.length === 0 && <div className="sub-empty">当前作用域还没有配置集，可到「配置集与生效」新建。</div>}
      </div>
    </>
  )
}
