import { useState } from 'react'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'
import GroupStatus from './GroupStatus'
import { ResourceGroup, ResourceList, ResourceRow, useResourceGroups } from './ResourceList'

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
  const { isOpen, toggle } = useResourceGroups('prompt')
  const needle = query.trim().toLowerCase()
  const searching = needle.length > 0
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle)
  const show = (kind: Filter) => filter === 'all' || filter === kind
  const open = (id: string) => isOpen(id, searching)

  const customRows = customs.filter((c) => matches(c.title))
  const sectionRows = catalog.sections.filter((entry) => matches(entry.name))
  const contextRows = catalog.contexts.filter((entry) => matches(entry.name))
  const toolRows = catalog.tools.filter((entry) => matches(entry.name))

  const catalogRow = (kind: CatalogKind, entry: { name: string; source: string; tokens: number }) => {
    const active = selected?.kind === kind && selected.name === entry.name
    return (
      <ResourceRow key={kind + ':' + entry.name} active={active}
        ariaLabel={'查看' + (kind === 'context' ? '运行上下文 ' : kind === 'tool' ? '工具定义 ' : '提示词段 ') + entry.name}
        data={{ promptitem: '', kind, name: entry.name }}
        onClick={() => actions.selectResource({ kind, name: entry.name })}>
        <span className="i-ico">{kind === 'context' ? '◷' : kind === 'tool' ? '⚙' : '¶'}</span>
        <span className="i-main">
          <span className="i-name">{entry.name}</span>
          <span className="i-meta">{entry.source} · {entry.tokens.toLocaleString('en-US')} t</span>
        </span>
        <span className="i-tail">
          <GroupStatus kind={kind} name={entry.name} />
          {active && <span className="i-off">查看中</span>}
        </span>
      </ResourceRow>
    )
  }

  const emptyText = (total: number, empty: string, missing: string) =>
    total === 0 ? empty : missing

  return (
    <ResourceList
      search={{
        value: query,
        onChange: setQuery,
        placeholder: '搜索提示词…',
        ariaLabel: '搜索提示词',
        data: { promptsearch: '' },
      }}
      actions={
        <>
          <button className="btn small" onClick={() => actions.newCustom()}>+ 新自定义</button>
          <button className="btn small" disabled={state.dshPromptsState === 'loading'} onClick={() => actions.loadDshPrompts()}>刷新宿主</button>
          <select className="filter-select" data-promptfilter value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)} aria-label="按类型筛选">
            <option value="all">全部类型</option>
            <option value="custom">自定义</option>
            <option value="section">提示词段</option>
            <option value="context">运行上下文</option>
            <option value="tool">工具定义</option>
          </select>
        </>
      }
    >
      {show('custom') && (
        <ResourceGroup groupId="prompt:custom" title="自定义提示词" count={customRows.length}
          open={open('prompt:custom')} onToggle={() => toggle('prompt:custom')}
          empty={customRows.length === 0
            ? <div className="sub-empty">{emptyText(customs.length, '该作用域还没有自定义提示词', '没有匹配的自定义提示词')}</div>
            : null}>
          {customRows.map((c) => {
            const active = selected?.kind === 'custom' && selected.id === c.id
            const on = c.enabled !== false
            return (
              <ResourceRow key={c.id} active={active}
                ariaLabel={'查看自定义提示词 ' + c.title}
                data={{ item: 'custom', customitem: '', id: c.id }}
                onClick={() => actions.selectResource({ kind: 'custom', id: c.id })}>
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
              </ResourceRow>
            )
          })}
        </ResourceGroup>
      )}

      {show('section') && (
        <ResourceGroup groupId="prompt:section" title="提示词段" count={sectionRows.length}
          open={open('prompt:section')} onToggle={() => toggle('prompt:section')}
          empty={state.dshPromptsState === 'loading'
            ? <div className="sub-empty">正在读取宿主注册提示词…</div>
            : state.dshPromptsState === 'error'
              ? <div className="sub-empty">宿主提示词读取失败：{state.dshPromptsError || '未知错误'}</div>
              : sectionRows.length === 0
                ? <div className="sub-empty">{emptyText(catalog.sections.length, '宿主没有返回提示词段', '没有匹配的提示词段')}</div>
                : null}>
          {sectionRows.map((entry) => catalogRow('section', entry))}
        </ResourceGroup>
      )}

      {show('context') && (
        <ResourceGroup groupId="prompt:context" title="运行上下文" count={contextRows.length}
          open={open('prompt:context')} onToggle={() => toggle('prompt:context')}
          empty={contextRows.length === 0
            ? <div className="sub-empty">{emptyText(catalog.contexts.length, '宿主没有返回运行上下文', '没有匹配的运行上下文')}</div>
            : null}>
          {contextRows.map((entry) => catalogRow('context', entry))}
        </ResourceGroup>
      )}

      {show('tool') && (
        <ResourceGroup groupId="prompt:tool" title="工具定义" count={toolRows.length}
          open={open('prompt:tool')} onToggle={() => toggle('prompt:tool')}
          empty={toolRows.length === 0
            ? <div className="sub-empty">{emptyText(catalog.tools.length, '宿主没有返回工具定义', '没有匹配的工具定义')}</div>
            : null}>
          {toolRows.map((entry) => catalogRow('tool', entry))}
        </ResourceGroup>
      )}

      <div className="note" style={{ marginTop: 12 }}>
        点击行在中栏查看全文；行尾只显示成员状态。提示词段与工具是否加入配置集，请到「配置集与生效」页编辑；运行上下文始终注入、不参与配置集。
      </div>
      {groups.length === 0 && <div className="sub-empty">当前作用域还没有配置集，可到「配置集与生效」新建。</div>}
    </ResourceList>
  )
}
