import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  DSH_SOURCE_LABEL,
  SCOPE_LABEL,
  type DshSkill,
  type Group,
  type GroupItem,
  type GroupItemKind,
} from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

type Filter = 'all' | 'selected' | 'unselected'
type Lane = 'all' | 'section' | 'tool' | 'mcp' | 'skill'

const fmt = (n: number) => n.toLocaleString('en-US')

function Toggle(props: {
  checked: boolean
  label: string
  disabled?: boolean
  title?: string
  data?: { check?: string; kind?: string; name?: string }
  onChange: () => void
}) {
  return (
    <label className={'switch' + (props.checked ? ' on' : '')} title={props.title}>
      <input type='checkbox' role='switch' data-check={props.data?.check} data-kind={props.data?.kind}
        data-name={props.data?.name} checked={props.checked} disabled={props.disabled}
        onChange={props.onChange} aria-label={props.label} />
      <span className='switch-track' aria-hidden='true'></span>
    </label>
  )
}

function SectionSwitch(props: {
  kind?: GroupItemKind
  name: string
  label: string
  meta?: string
  checked: boolean
  onChange: () => void
  onPreview?: () => void
  focused?: boolean
}) {
  const kind = props.kind ?? 'section'
  return (
    <div className={'check-row switch-row' + (props.focused ? ' focus-flash' : '')}>
      <Toggle checked={props.checked} data={{ check: '1', kind, name: props.name }}
        label={props.label + (props.checked ? '（注入）' : '（拦截）')}
        title={props.checked ? '已注入' : '已拦截'} onChange={props.onChange} />
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
  tokens?: number
  readonly?: boolean
  onAll?: () => void
  onClear?: () => void
  nested?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  const nested = props.nested !== false
  return (
    <details className={nested ? 'subres' : 'res'} open={open} data-readonly={props.readonly ? '1' : undefined}
      onToggle={(e) => { const next = e.currentTarget.open; if (next !== open) setOpen(next) }}>
      <summary className={nested ? 'source-head sub-head' : 'res-head'}>
        <span className="twist" aria-hidden="true">▸</span>
        <span>{props.title}</span>
        <span className="count">{props.readonly ? fmt(props.total) : fmt(props.selected) + '/' + fmt(props.total)}</span>
        {props.tokens !== undefined && <span className="muted">{fmt(props.tokens)} t</span>}
        <span className="spacer"></span>
        {!props.readonly && props.onAll && <button className="btn tiny" onClick={(e) => { e.preventDefault(); props.onAll?.() }}>全选</button>}
        {!props.readonly && props.onClear && <button className="btn tiny" onClick={(e) => { e.preventDefault(); props.onClear?.() }}>清空</button>}
      </summary>
      {props.children}
    </details>
  )
}


export function DshSkillRow(props: {
  skill: DshSkill
  scopeKind: 'global' | 'workspace'
  onPolicy: (state: 'on' | 'off') => void
  onDetails: () => void
}) {
  const { skill: sk, scopeKind } = props
  const policyFrom = scopeKind === 'workspace'
    ? sk.policyFrom === 'workspace'
      ? '本层覆盖'
      : sk.policyFrom === 'global'
        ? '继承全局'
        : '默认'
    : sk.policyFrom === 'global'
      ? '本层覆盖'
      : '默认'
  const locked = sk.source === 'runtime' || sk.source.startsWith('dsh-csmm')
    ? '插件技能 · 不可停用'
    : 'Git 管理 · 不可停用'
  return (
    <div className="res-row" data-gdshitem data-name={sk.name}
      data-gdsh-policy-state={sk.policy} data-gdsh-policy-from={sk.policyFrom}>
      <Toggle checked={!sk.disabled} disabled={!sk.canDisable}
        label={sk.name + (sk.disabled ? '（已停用）' : '（已启用）')}
        title={sk.canDisable ? (sk.disabled ? '已停用，点击启用' : '已启用，点击停用') : locked}
        onChange={() => props.onPolicy(sk.disabled ? 'on' : 'off')} />
      <span className="r-ico">◆</span>
      <span className="c-label">{sk.name}</span>
      <span className="muted">
        {sk.rootLabel} · {DSH_SOURCE_LABEL[sk.source] ?? sk.source}
        {sk.provider ? ' · ' + sk.provider : ''}
        {sk.model ? (sk.user ? '' : ' · 仅模型') : sk.user ? ' · 仅用户' : ' · 不可调用'}
        {' · '}{policyFrom}
      </span>
      {sk.disabled && <span className="tag off">已停用</span>}
      {!sk.canDisable && <span className="muted" data-gdsh-policy-locked>{locked}</span>}
      <button type="button" className="linkbtn" data-manage="dsh-skill" data-name={sk.name}
        onClick={props.onDetails}>详情</button>
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
  const [lane, setLane] = useState<Lane>('all')
  const [focusRow, setFocusRow] = useState<{ kind: GroupItemKind; name: string } | null>(null)
  useEffect(() => { actions.ensureDraft(g) }, [g.id])
  useEffect(() => { setName(g.name) }, [g.id, g.name])
  useEffect(() => { setQuery(''); setFilter('all'); setLane('all'); setFocusRow(null) }, [g.id])

  const focusNonce = state.groupFocus?.nonce ?? 0
  useEffect(() => {
    const focus = state.groupFocus
    if (!focus) return
    setLane(focus.kind === 'tool' ? 'tool' : focus.kind === 'mcp' ? 'mcp' : focus.kind === 'skill' ? 'skill' : 'section')
    setQuery('')
    setFilter('all')
    setFocusRow({ kind: focus.kind, name: focus.name })
    const timer = window.setTimeout(() => {
      const selector = '[data-check][data-kind="' + focus.kind + '"][data-name="' + CSS.escape(focus.name) + '"]'
      const row = document.querySelector(selector)?.closest('.check-row, .res-row') as HTMLElement | null
      row?.scrollIntoView({ block: 'center' })
      actions.clearGroupFocus()
    }, 180)
    return () => window.clearTimeout(timer)
  }, [focusNonce])
  useEffect(() => {
    if (state.groupFocus || !focusRow) return
    const timer = window.setTimeout(() => setFocusRow(null), 1400)
    return () => window.clearTimeout(timer)
  }, [state.groupFocus, focusRow])

  const draft = (state.drafts[selectors.draftId(g)] as GroupItem[] | undefined) || g.items
  const dirty = name !== g.name || JSON.stringify(draft) !== JSON.stringify(g.items)
  const counts: Record<GroupItemKind, number> = { section: 0, mcp: 0, skill: 0, tool: 0 }
  draft.forEach((it) => { if (counts[it.kind] !== undefined) counts[it.kind]++ })
  const visibleSkills = selectors.visibleSkills(state)
  const visibleServers = selectors.visibleServers(state)
  const sources = selectors.groupSources(state.meta)
  const check = (kind: GroupItemKind, n: string): boolean => selectors.hasItem(draft, kind, n)
  const isFocused = (kind: GroupItemKind, n: string): boolean => focusRow?.kind === kind && focusRow.name === n
  const toggle = (kind: GroupItemKind, n: string) => actions.toggleDraftCheck(g, kind, n)
  const onSave = () => actions.saveGroup(g, name)
  const onRevert = () => {
    actions.revertGroup(g)
    setName(g.name)
  }
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
  const dshSkillList = filter === 'all'
    ? selectors.visibleDshSkills(state).filter((sk) => {
        if (!needle) return true
        const haystack = (sk.name + ' ' + sk.description + ' ' + (sk.whenToUse || '') + ' ' + sk.source + ' ' + sk.provider).toLowerCase()
        return haystack.includes(needle)
      })
    : []
  const dshSkillGroups = selectors.groupDshSkills(dshSkillList)
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
  const promptView = lane === 'tool'
    ? { title: '工具定义', selected: toolCount, total: dshTools.length, tokens: toolTokens }
    : lane === 'section'
      ? { title: '提示词段', selected: sectionCount, total: sections.length, tokens: sectionTokens }
      : { title: '提示词与工具', selected: promptSelected, total: promptTotal, tokens: promptTokens }

  const toggleMany = (kind: GroupItemKind, names: string[], on: boolean) => {
    names.forEach((resource) => {
      if (check(kind, resource) !== on) actions.toggleDraftCheck(g, kind, resource)
    })
  }
  const togglePromptAll = (on: boolean) => {
    if (lane !== 'tool') toggleMany('section', sectionList.map((s) => s.name), on)
    if (lane !== 'section') toggleMany('tool', toolList.map((t) => t.name), on)
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

  const toolGroup = (
    <SectionGroup title="工具定义" selected={toolCount} total={dshTools.length} tokens={toolTokens}
      onAll={() => toggleMany('tool', toolList.map((t) => t.name), true)}
      onClear={() => toggleMany('tool', toolList.map((t) => t.name), false)}>
      <div className="note" data-tools-note>
        {toolCount === 0
          ? '没有勾选工具：保存并生效后，所有工具都会被拒绝。至少勾选一个工具。'
          : '生效后只放行勾选的工具；未勾选的不会出现在 agent 里。'}
      </div>
      {toolList.map((tool) => (
        <SectionSwitch key={tool.name} kind="tool" name={tool.name} label={tool.name} meta={fmt(tool.tokens) + ' t'}
          checked={check('tool', tool.name)} onChange={() => toggle('tool', tool.name)} focused={isFocused('tool', tool.name)}
          onPreview={() => actions.openDetail({ kind: 'prompt', promptKind: 'tool', name: tool.name })} />
      ))}
      {!toolList.length && <div className="empty">没有匹配的工具定义。</div>}
    </SectionGroup>
  )

  return (
    <>
      <div className="editor-head">
        <div className="crumbs">
          <span>{selectors.scopeCrumb(g.scope, state.meta)}</span><span className="sep">›</span><span>配置集</span>
        </div>
        <div className="title-row">
          <input id="itemName" className="title-input" value={name} onChange={(e) => setName(e.target.value)}
            aria-label="配置集名称" />
          <span className={'chip scope-' + g.scope.kind}>{SCOPE_LABEL[g.scope.kind]}</span>
          <span className="chip">配置集</span>
          <span className={'chip state-' + stateClass}>{stateLabel}</span>
        </div>
      </div>
      <div className="editor-body">
        <div className="banner">设为生效后只保留本配置集列出的项；未列入的资源不会进入生效提示词。勾选变化需点「保存」才生效。</div>
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
            本配置集没有勾选任何提示词段：设为生效后系统提示词为空，仅保留技能与 MCP。配置集白名单不区分类型，需要提示词段时请在上方一并勾选。
          </div>
        )}

        <div className="seg lane-tabs" role="group" aria-label="资源类型">
          {([['all', '全部'], ['section', '提示词段'], ['tool', '工具'], ['mcp', 'MCP'], ['skill', '技能']] as Array<[Lane, string]>).map(([key, label]) => (
            <button key={key} className="btn tiny" data-lane={key} aria-pressed={lane === key} onClick={() => setLane(key)}>{label}</button>
          ))}
        </div>

        <div className="editor-tools">
          <input type="search" className="search" value={query} onChange={(e) => setQuery(e.target.value)}
            title="仅搜索当前配置集可加入的资源" placeholder="搜索本配置集可加入的资源…" aria-label="搜索配置集资源" />
          <div className="seg" role="group" aria-label="资源筛选">
            {([['all', '全部'], ['selected', '已包含'], ['unselected', '未包含']] as Array<[Filter, string]>).map(([key, label]) => (
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

        {(lane === 'all' || lane === 'section') && (
        <SectionGroup title={promptView.title} selected={promptView.selected} total={promptView.total} tokens={promptView.tokens}
          onAll={() => togglePromptAll(true)} onClear={() => togglePromptAll(false)} nested={false}>
          {(lane === 'all' || lane === 'section') && sources.map((src) => {
            const list = sectionList.filter((s) => s.source === src)
            if (!list.length) return null
            return (
              <SectionGroup key={src} title={src} selected={list.filter((s) => check('section', s.name)).length}
                total={list.length} tokens={sumTokens(list, 'section')}
                onAll={() => toggleMany('section', list.map((s) => s.name), true)}
                onClear={() => toggleMany('section', list.map((s) => s.name), false)}>
                {list.map((s) => (
                  <SectionSwitch key={s.name} name={s.name} label={s.name} meta={fmt(s.tokens) + ' t'}
                    checked={check('section', s.name)} onChange={() => toggle('section', s.name)} focused={isFocused('section', s.name)}
                    onPreview={() => actions.openDetail({ kind: 'prompt', promptKind: 'section', name: s.name })} />
                ))}
              </SectionGroup>
            )
          })}
          {(lane === 'all' || lane === 'section') && dshSections.length > 0 && (
            <SectionGroup title="DSH 注册提示词" selected={dshSections.filter((s) => check('section', s.name)).length}
              total={dshSections.length} tokens={dshTokens}
              onAll={() => toggleMany('section', dshSections.filter((s) => match('section', s.name)).map((s) => s.name), true)}
              onClear={() => toggleMany('section', dshSections.filter((s) => match('section', s.name)).map((s) => s.name), false)}>
              {dshSections.filter((s) => match('section', s.name)).map((s) => (
                <SectionSwitch key={s.name} name={s.name} label={s.name} meta={fmt(s.tokens) + ' t'}
                  checked={check('section', s.name)} onChange={() => toggle('section', s.name)} focused={isFocused('section', s.name)}
                  onPreview={() => actions.openDetail({ kind: 'prompt', promptKind: 'section', name: s.name })} />
              ))}
            </SectionGroup>
          )}
          {lane === 'all' && toolGroup}
          {!sectionList.length && <div className="empty">没有匹配的提示词段。</div>}
        </SectionGroup>
        )}
        {lane === 'tool' && toolGroup}

        {(lane === 'all' || lane === 'mcp') && (
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
            <div key={srv.name} className={'res-row' + (isFocused('mcp', srv.name) ? ' focus-flash' : '')}>
              <input type="checkbox" data-check="1" data-kind="mcp" data-name={srv.name}
                checked={check('mcp', srv.name)} onChange={() => toggle('mcp', srv.name)} aria-label={srv.name} />
              <span className="r-ico">⚡</span>
              <span className={'status-dot ' + (srv.status === 'connected' ? 'on' : 'off')}></span>
              <span className="c-label">{srv.name}</span>
              <span className="muted">mcp:{srv.name} · {fmt(srv.tools.length)} 工具</span>
              <button className="linkbtn" data-manage="mcp" data-name={srv.name}
                onClick={() => { actions.setTab('mcp'); actions.selectResource({ kind: 'mcp', name: srv.name }) }}>详情</button>
            </div>
          ))}
          {!serverList.length && <div className="empty">没有匹配的 MCP 服务器。</div>}
        </details>
        )}

        {(lane === 'all' || lane === 'skill') && (
        <details className="res" open>
          <summary className="res-head">
            <span>技能</span>
            <span className="count" id="skillCount">{fmt(counts.skill)}/{fmt(visibleSkills.length)}</span>
            <span className="muted">{fmt(selectors.groupTokens({ items: draft.filter((it) => it.kind === 'skill') }, state))} t</span>
            <span className="tag">按可见性</span>
            {dshSkillList.length > 0 && <span className="tag" data-gdshcount>DSH {dshSkillList.length}</span>}
            <span className="spacer"></span>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('skill', skillList.map((s) => s.name), true) }}>全选</button>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('skill', skillList.map((s) => s.name), false) }}>清空</button>
          </summary>
          {skillList.map((sk) => (
            <div key={sk.name} className={'res-row' + (isFocused('skill', sk.name) ? ' focus-flash' : '')}>
              <input type="checkbox" data-check="1" data-kind="skill" data-name={sk.name}
                checked={check('skill', sk.name)} onChange={() => toggle('skill', sk.name)} aria-label={sk.name} />
              <span className="r-ico">◆</span>
              <span className="c-label">{sk.name}</span>
              <span className="muted">{selectors.formatKB(sk.bytes)} KB · {sk.model ? '模型可调用' : sk.user ? '仅用户可用' : '不可调用'}</span>
              <button className="linkbtn" data-manage="skill" data-name={sk.name}
                onClick={() => { actions.setTab('skill'); actions.selectResource({ kind: 'skill', name: sk.name }) }}>详情</button>
            </div>
          ))}
          {dshSkillGroups.length > 0 && (
            <div className="note gdsh-note" data-gdsh-note>以下 DSH 注册表技能由宿主提供；作用域策略在当前作用域立即保存，不属于本配置集勾选。</div>
          )}
          {dshSkillGroups.map((group) => (
            <SectionGroup key={'gdsh:' + group.key} title={group.label} selected={0} total={group.skills.length} readonly>
              {group.skills.map((sk) => (
                <DshSkillRow key={sk.name} skill={sk} scopeKind={state.scope.kind}
                  onPolicy={(next) => { void actions.setDshSkillPolicy(sk.name, sk.source, next) }}
                  onDetails={() => { actions.setTab('skill'); actions.selectResource({ kind: 'skill', name: sk.name }) }} />
              ))}
            </SectionGroup>
          ))}
          {!skillList.length && !dshSkillGroups.length && <div className="empty">没有匹配的技能。</div>}
        </details>
        )}

        {lane !== 'mcp' && lane !== 'skill' && (
        <details className="unlisted">
          <summary>未包含的资源（点一下加入本配置集）</summary>
          <div className="chips">
            {(lane === 'all' || lane === 'section') && sections.filter((s) => !check('section', s.name) && (!needle || s.name.toLowerCase().includes(needle))).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="section" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'section', s.name)}>+ {s.name}</button>
            ))}
            {lane === 'all' && visibleServers.filter((s) => !check('mcp', s.name) && (!needle || s.name.toLowerCase().includes(needle))).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="mcp" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'mcp', s.name)}>+ ⚡{s.name}</button>
            ))}
            {lane === 'all' && visibleSkills.filter((s) => !check('skill', s.name) && (!needle || s.name.toLowerCase().includes(needle))).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="skill" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'skill', s.name)}>+ ◆{s.name}</button>
            ))}
            {(lane === 'all' || lane === 'tool') && dshTools.filter((t) => !check('tool', t.name) && (!needle || t.name.toLowerCase().includes(needle))).map((t) => (
              <button key={t.name} className="add-chip" data-additem data-kind="tool" data-name={t.name}
                onClick={() => actions.addDraftItem(g, 'tool', t.name)}>+ ⚙{t.name}</button>
            ))}
          </div>
        </details>
        )}
      </div>
      <div className="editor-foot">
        {effId !== g.id && <button className="btn small" data-effective title={dirty ? '保存当前名称与成员并设为生效' : '设为当前作用域的生效配置集，右侧预览即时更新'} onClick={() => {
          actions.setEffectiveGroup(g.id, dirty ? { name } : undefined)
        }}>{dirty ? '保存并设为生效' : '设为生效'}</button>}
        <button id="saveBtn" className="btn primary" title="只保存草稿，不改动生效配置集" disabled={!dirty} onClick={onSave}>保存草稿</button>
        <button id="revertBtn" className="btn" disabled={!dirty} onClick={onRevert}>还原</button>
        {dirty && <span className="hint dirty">未保存更改</span>}
        <span className="grow"></span>
        {delArm
          ? <><button className="btn danger small" data-gdel="yes" onClick={() => actions.deleteItem(g, 'group')}>确认删除</button>
            <button className="btn small" onClick={() => setDelArm(false)}>取消</button></>
          : <button id="deleteBtn" className="btn danger" onClick={() => setDelArm(true)}>删除配置集</button>}
      </div>
    </>
  )
}
