import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  SCOPE_LABEL,
  type Group,
  type GroupItem,
  type GroupItemKind,
} from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

type Filter = 'all' | 'selected' | 'unselected'

const fmt = (n: number) => n.toLocaleString('en-US')

function SectionSwitch(props: {
  kind?: GroupItemKind
  name: string
  label: string
  meta?: string
  checked: boolean
  onChange: () => void
  onPreview?: () => void
}) {
  const kind = props.kind ?? 'section'
  return (
    <div className='check-row switch-row'>
      <label className={'switch' + (props.checked ? ' on' : '')} title={props.checked ? '已注入' : '已拦截'}>
        <input type='checkbox' role='switch' data-check='1' data-kind={kind} data-name={props.name}
          checked={props.checked} onChange={props.onChange} aria-label={props.label + (props.checked ? '（注入）' : '（拦截）')} />
        <span className='switch-track' aria-hidden='true'></span>
      </label>
      <label className='c-label' onClick={props.onChange}>{props.label}</label>
      {props.meta && <span className='muted'>{props.meta}</span>}
      {props.onPreview && <button type='button' className='linkbtn' data-preview={kind} data-name={props.name}
        onClick={props.onPreview}>预览</button>}
    </div>
  )
}

function SectionGroup(props: {
  title: string
  selected: number
  total: number
  tokens: number
  tag?: string
  tagTitle?: string
  onAll?: () => void
  onClear?: () => void
  extra?: ReactNode
  nested?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  const nested = props.nested !== false
  return (
    <details className={nested ? 'subres' : 'res'} open={open}
      onToggle={(e) => { const next = e.currentTarget.open; if (next !== open) setOpen(next) }}>
      <summary className={nested ? 'source-head sub-head' : 'res-head'}>
        <span className="twist" aria-hidden="true">▸</span>
        <span>{props.title}</span>
        <span className="count">{fmt(props.selected)}/{fmt(props.total)}</span>
        <span className="muted">{fmt(props.tokens)} t</span>
        {props.tag && <span className="tag" title={props.tagTitle}>{props.tag}</span>}
        {props.extra}
        <span className="spacer"></span>
        {props.onAll && <button className="btn tiny" onClick={(e) => { e.preventDefault(); props.onAll?.() }}>全选</button>}
        {props.onClear && <button className="btn tiny" onClick={(e) => { e.preventDefault(); props.onClear?.() }}>清空</button>}
      </summary>
      {props.children}
    </details>
  )
}

function CheckRow(props: {
  kind: GroupItemKind
  name: string
  label: string
  meta?: string
  checked?: boolean
  disabled?: boolean
  onChange?: () => void
  onPreview?: () => void
  icon?: ReactNode
}) {
  const { kind, name, label, meta, checked, disabled, onChange, onPreview, icon } = props
  return (
    <div className={'check-row' + (disabled ? ' resident' : '')}>
      <input type="checkbox" data-check="1" data-kind={kind} data-name={name} checked={!!checked}
        disabled={disabled} onChange={onChange} aria-label={label} />
      {icon && <span className="r-ico">{icon}</span>}
      <label className="c-label" onClick={() => { if (!disabled) onChange?.() }}>{label}</label>
      {meta && <span className="muted">{meta}</span>}
      {onPreview && <button type="button" className="linkbtn" data-preview={kind} data-name={name}
        onClick={onPreview}>预览</button>}
    </div>
  )
}

export default function GroupEditor({ g }: { g: Group }) {
  const { state, actions, selectors } = useAppViewModel()
  const ownSections = state.meta.sections.filter((section) => section.kind === 'section')
  const dshSections = state.dshPrompts
    .filter(
      (p) =>
        p.kind === 'section' &&
        !p.name.startsWith('dsh-csmm:') &&
        !ownSections.some((s) => s.name === p.name),
    )
    .map((p) => ({ name: p.name, source: 'DSH', tokens: p.tokens }))
  const dshTools = state.dshPrompts
    .filter((p) => p.kind === 'tool' && p.name.startsWith('tool-schema:'))
    .map((p) => ({ name: p.name.slice('tool-schema:'.length), tokens: p.tokens }))
  const sections = [...ownSections, ...dshSections]
  const [name, setName] = useState(g.name)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [modeDirty, setModeDirty] = useState(false)
  useEffect(() => { actions.ensureDraft(g) }, [g.id])
  useEffect(() => { setName(g.name) }, [g.id, g.name])
  useEffect(() => { setQuery(''); setFilter('all'); setModeDirty(false) }, [g.id])

  const draft = (state.drafts[selectors.draftId(g)] as GroupItem[] | undefined) || g.items
  const dirty = modeDirty || name !== g.name || JSON.stringify(draft) !== JSON.stringify(g.items)
  const counts: Record<GroupItemKind, number> = { section: 0, mcp: 0, skill: 0, tool: 0 }
  draft.forEach((it) => { if (counts[it.kind] !== undefined) counts[it.kind]++ })
  const visibleSkills = selectors.visibleSkills(state)
  const visibleServers = selectors.visibleServers(state)
  const sources = selectors.groupSources(state.meta)
  const check = (kind: GroupItemKind, n: string): boolean => selectors.hasItem(draft, kind, n)
  const toggle = (kind: GroupItemKind, n: string) => actions.toggleDraftCheck(g, kind, n)
  const onSave = () => { actions.saveGroup(g, name); setModeDirty(false) }
  const onRevert = () => { actions.revertGroup(g); setName(g.name); setModeDirty(false) }
  const setMode = (mode: 'all' | 'allow') => { actions.setToolsMode(g, mode); setModeDirty(true) }

  const needle = query.trim().toLowerCase()
  const match = (kind: GroupItemKind, resource: string): boolean => {
    if (needle && !resource.toLowerCase().includes(needle)) return false
    const on = check(kind, resource)
    if (filter === 'selected') return on
    if (filter === 'unselected') return !on
    return true
  }
  const sectionCount = sections.filter((section) => check('section', section.name)).length
  const sectionList = sections.filter((section) => match('section', section.name))
  const serverList = visibleServers.filter((server) => match('mcp', server.name))
  const skillList = visibleSkills.filter((skill) => match('skill', skill.name))
  const toolList = dshTools.filter((tool) => match('tool', tool.name))
  const toolCount = dshTools.filter((tool) => check('tool', tool.name)).length
  const sumTokens = (list: Array<{ name: string; tokens: number }>, kind: GroupItemKind) =>
    list.filter((entry) => check(kind, entry.name)).reduce((sum, entry) => sum + entry.tokens, 0)
  const dshTokens = sumTokens(dshSections, 'section')
  const sectionTokens = sumTokens(sections, 'section')
  const toolTokens = sumTokens(dshTools, 'tool')
  const promptSelected = sectionCount + toolCount
  const promptTotal = sections.length + dshTools.length
  const promptTokens = sectionTokens + toolTokens
  const runtimeContexts = state.dshPrompts.filter((p) => p.kind === 'context').map((p) => ({ name: p.name, tokens: p.tokens }))
  const contextList = runtimeContexts.length ? runtimeContexts : state.meta.sections.filter((s) => s.kind === 'context')
  const contextTokens = contextList.reduce((sum, s) => sum + s.tokens, 0)

  const toggleMany = (kind: GroupItemKind, names: string[], on: boolean) => {
    names.forEach((resource) => {
      if (check(kind, resource) !== on) actions.toggleDraftCheck(g, kind, resource)
    })
  }
  const togglePromptAll = (on: boolean) => {
    toggleMany('section', sectionList.map((s) => s.name), on)
    toggleMany('tool', toolList.map((t) => t.name), on)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dirty) {
        e.preventDefault()
        actions.saveGroup(g, name)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, name, g.id])

  const [delArm, setDelArm] = useState(false)
  useEffect(() => { setDelArm(false) }, [g.id])
  const effId = state.activeGroup[selectors.scopeKey(g.scope)]
  const stateLabel = effId === g.id ? '生效中' : effId === '' ? '本层为空' : '继承中'
  const stateClass = effId === g.id ? 'on' : effId === '' ? 'off' : 'inherit'

  return (
    <>
      <div className="editor-head">
        <div className="crumbs">
          <span>{selectors.scopeCrumb(g.scope, state.meta)}</span><span className="sep">›</span><span>分组</span>
        </div>
        <div className="title-row">
          <input id="itemName" className="title-input" value={name} onChange={(e) => setName(e.target.value)}
            aria-label="分组名称" />
          <span className={'chip scope-' + g.scope.kind}>{SCOPE_LABEL[g.scope.kind]}</span>
          <span className="chip">分组</span>
          <span className={'chip state-' + stateClass}>{stateLabel}</span>
        </div>
      </div>
      <div className="editor-body">
        <div className="banner">启用后只保留本组列出的项；未列入的资源不会进入生效提示词。勾选变化需点「保存」才生效。</div>
        <div className="summary-line">
          <span className="pill" id="sumSection">提示词段 {fmt(sectionCount)}</span>
          <span className="pill" id="sumTool">工具 {fmt(toolCount)}</span>
          <span className="pill" id="sumMcp">MCP {fmt(counts.mcp)}</span>
          <span className="pill" id="sumSkill">技能 {fmt(counts.skill)}</span>
          <span className="grow"></span>
          <span className="muted" id="sumChars" title="仅统计本组列出的提示词段、工具、技能与 MCP，不含自定义提示词与运行上下文">组内资源 ≈ {fmt(selectors.groupTokens({ items: draft }, state))} t</span>
        </div>
        {sectionCount === 0 && (counts.skill > 0 || counts.mcp > 0) && (
          <div className="note" data-empty-prompt>
            本组没有勾选任何提示词段：设为生效后系统提示词为空，仅保留技能与 MCP。分组白名单不区分类型，需要提示词段时请在上方一并勾选。
          </div>
        )}

        <div className="editor-tools">
          <input type="search" className="search" value={query} onChange={(e) => setQuery(e.target.value)}
            title="仅搜索当前分组可加入的资源" placeholder="搜索本组可加入的资源…" aria-label="搜索本组资源" />
          <div className="seg" role="group" aria-label="资源筛选">
            {([['all', '全部'], ['selected', '已选'], ['unselected', '未选']] as Array<[Filter, string]>).map(([key, label]) => (
              <button key={key} className="btn tiny" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="xlink-row">
          <div className="xlink" data-gotab="mcp" role="link" tabIndex={0} onClick={() => actions.setTab('mcp')}
            onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.setTab('mcp') }
            }}>
            <span>⚡</span><span>去管理 MCP 工具</span><span className="muted">›</span>
          </div>
          <div className="xlink" data-gotab="skill" role="link" tabIndex={0} onClick={() => actions.setTab('skill')}
            onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.setTab('skill') }
            }}>
            <span>◆</span><span>去管理技能</span><span className="muted">›</span>
          </div>
        </div>

        <SectionGroup title="提示词与工具" selected={promptSelected} total={promptTotal} tokens={promptTokens}
          tagTitle="只放行分组列出的段与工具，未列入的不进入提示词"
          onAll={() => togglePromptAll(true)} onClear={() => togglePromptAll(false)} nested={false}>
          {sources.map((src) => {
            const list = sectionList.filter((s) => s.source === src)
            if (!list.length) return null
            return (
              <SectionGroup key={src} title={src} selected={list.filter((s) => check('section', s.name)).length}
                total={list.length} tokens={sumTokens(list, 'section')}
                onAll={() => toggleMany('section', list.map((s) => s.name), true)}
                onClear={() => toggleMany('section', list.map((s) => s.name), false)}>
                {list.map((s) => (
                  <SectionSwitch key={s.name} name={s.name} label={s.name} meta={fmt(s.tokens) + ' t'}
                    checked={check('section', s.name)} onChange={() => toggle('section', s.name)}
                    onPreview={() => actions.openDetail({ kind: 'prompt', promptKind: 'section', name: s.name })} />
                ))}
              </SectionGroup>
            )
          })}
          {dshSections.length > 0 && (
            <SectionGroup title="DSH 注册提示词" selected={dshSections.filter((s) => check('section', s.name)).length}
              total={dshSections.length} tokens={dshTokens}
              onAll={() => toggleMany('section', dshSections.filter((s) => match('section', s.name)).map((s) => s.name), true)}
              onClear={() => toggleMany('section', dshSections.filter((s) => match('section', s.name)).map((s) => s.name), false)}>
              {dshSections.filter((s) => match('section', s.name)).map((s) => (
                <SectionSwitch key={s.name} name={s.name} label={s.name} meta={fmt(s.tokens) + ' t'}
                  checked={check('section', s.name)} onChange={() => toggle('section', s.name)}
                  onPreview={() => actions.openDetail({ kind: 'prompt', promptKind: 'section', name: s.name })} />
              ))}
            </SectionGroup>
          )}
          <SectionGroup title="工具定义" selected={toolCount} total={dshTools.length} tokens={toolTokens}
            tag={g.toolsMode === 'allow' ? '白名单' : '未接管'}
            tagTitle="勾选任意工具后只放行勾选项；一组都不勾选则不过滤工具"
            extra={g.toolsMode === 'allow'
              ? <button className="btn tiny" onClick={(e) => { e.preventDefault(); setMode('all') }}>不过滤</button>
              : <button className="btn tiny" onClick={(e) => { e.preventDefault(); setMode('allow') }}>接管</button>}
            onAll={() => toggleMany('tool', toolList.map((t) => t.name), true)}
            onClear={() => toggleMany('tool', toolList.map((t) => t.name), false)}>
            {toolList.map((tool) => (
              <SectionSwitch key={tool.name} kind="tool" name={tool.name} label={tool.name} meta={fmt(tool.tokens) + ' t'}
                checked={check('tool', tool.name)} onChange={() => toggle('tool', tool.name)}
                onPreview={() => actions.openDetail({ kind: 'prompt', promptKind: 'tool', name: tool.name })} />
            ))}
            {!toolList.length && <div className="empty">没有匹配的工具定义。</div>}
          </SectionGroup>
          <SectionGroup title="运行上下文" selected={contextList.length} total={contextList.length} tokens={contextTokens} tag="只读">
            {contextList.map((s) => (
              <CheckRow key={s.name} kind="section" name={s.name} label={s.name} meta={fmt(s.tokens) + ' t'}
                checked disabled
                onPreview={() => actions.openDetail({ kind: 'prompt', promptKind: 'context', name: s.name })} />
            ))}
          </SectionGroup>
          {!sectionList.length && <div className="empty">没有匹配的提示词段。</div>}
        </SectionGroup>

        <details className="res" open>
          <summary className="res-head">
            <span>MCP 服务器</span>
            <span className="count" id="mcpCount">{fmt(counts.mcp)}/{fmt(visibleServers.length)}</span>
            <span className="muted">{fmt(selectors.groupTokens({ items: draft.filter((it) => it.kind === 'mcp') }, state))} t</span>
            <span className="tag cat-mcp" title="勾选服务器会同时带上它的配对段与工具">段 + 工具成对</span>
            <span className="spacer"></span>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('mcp', serverList.map((s) => s.name), true) }}>全选</button>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('mcp', serverList.map((s) => s.name), false) }}>清空</button>
          </summary>
          {serverList.map((srv) => (
            <div key={srv.name} className="res-row">
              <input type="checkbox" data-check="1" data-kind="mcp" data-name={srv.name}
                checked={check('mcp', srv.name)} onChange={() => toggle('mcp', srv.name)} aria-label={srv.name} />
              <span className="r-ico">⚡</span>
              <span className={'status-dot ' + (srv.status === 'connected' ? 'on' : 'off')}></span>
              <span className="c-label">{srv.name}</span>
              <span className="muted">mcp:{srv.name} · {fmt(srv.tools.length)} 工具</span>
              <button className="linkbtn" data-manage="mcp" data-name={srv.name}
                onClick={() => actions.openDetail({ kind: 'mcp', name: srv.name })}>详情</button>
            </div>
          ))}
          {!serverList.length && <div className="empty">没有匹配的 MCP 服务器。</div>}
        </details>

        <details className="res" open>
          <summary className="res-head">
            <span>技能</span>
            <span className="count" id="skillCount">{fmt(counts.skill)}/{fmt(visibleSkills.length)}</span>
            <span className="muted">{fmt(selectors.groupTokens({ items: draft.filter((it) => it.kind === 'skill') }, state))} t</span>
            <span className="tag">按可见性</span>
            <span className="spacer"></span>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('skill', skillList.map((s) => s.name), true) }}>全选</button>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('skill', skillList.map((s) => s.name), false) }}>清空</button>
          </summary>
          {skillList.map((sk) => (
            <div key={sk.name} className="res-row">
              <input type="checkbox" data-check="1" data-kind="skill" data-name={sk.name}
                checked={check('skill', sk.name)} onChange={() => toggle('skill', sk.name)} aria-label={sk.name} />
              <span className="r-ico">◆</span>
              <span className="c-label">{sk.name}</span>
              <span className="muted">{selectors.formatKB(sk.bytes)} KB · {sk.model ? '模型可调用' : '仅用户可用'}</span>
              <button className="linkbtn" data-manage="skill" data-name={sk.name}
                onClick={() => actions.openDetail({ kind: 'skill', name: sk.name })}>详情</button>
            </div>
          ))}
          {!skillList.length && <div className="empty">没有匹配的技能。</div>}
        </details>

        <details className="unlisted">
          <summary>未列入的资源（点一下加入本组）</summary>
          <div className="chips">
            {sections.filter((s) => !check('section', s.name) && (!needle || s.name.toLowerCase().includes(needle))).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="section" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'section', s.name)}>+ {s.name}</button>
            ))}
            {visibleServers.filter((s) => !check('mcp', s.name) && (!needle || s.name.toLowerCase().includes(needle))).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="mcp" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'mcp', s.name)}>+ ⚡{s.name}</button>
            ))}
            {visibleSkills.filter((s) => !check('skill', s.name) && (!needle || s.name.toLowerCase().includes(needle))).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="skill" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'skill', s.name)}>+ ◆{s.name}</button>
            ))}
          </div>
        </details>
      </div>
      <div className="editor-foot">
        {effId !== g.id && <button className="btn small" data-effective title={dirty ? '保存当前更改并设为生效分组' : '设为当前作用域的生效分组，右侧预览即时更新'} onClick={() => actions.setEffectiveGroup(g.id)}>{dirty ? '保存并设为生效' : '设为生效'}</button>}
        <button id="saveBtn" className="btn primary" title="只保存草稿，不改动生效分组" disabled={!dirty} onClick={onSave}>保存草稿</button>
        <button id="revertBtn" className="btn" disabled={!dirty} onClick={onRevert}>还原</button>
        {dirty && <span className="hint dirty">未保存更改</span>}
        <span className="grow"></span>
        {delArm
          ? <><button className="btn danger small" data-gdel="yes" onClick={() => actions.deleteItem(g, 'group')}>确认删除</button>
            <button className="btn small" onClick={() => setDelArm(false)}>取消</button></>
          : <button id="deleteBtn" className="btn danger" onClick={() => setDelArm(true)}>删除分组</button>}
      </div>
    </>
  )
}
