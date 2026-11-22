import { Fragment, useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import type { MigrateModal, RawModal, ServerFormModal, WorkspaceTrustModal } from '../../contracts'
import {
  MCP_NAME_RE,
  buildServerInput,
  defaultServerForm,
  serverFormFrom,
  type ServerFormState,
} from '../../viewmodel/serverForm'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

function SkillAdd() {
  const { state, actions, selectors } = useAppViewModel()
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)
  const pick = (fromFolder: boolean) => {
    const ref = fromFolder ? dirRef : fileRef
    if (ref.current) ref.current.click()
  }
  const onChange = (e: ChangeEvent<HTMLInputElement>, fromFolder: boolean) => {
    actions.addSkillsFromFiles(e.target.files, fromFolder)
    actions.closeModal()
  }
  const dirProps = { webkitdirectory: '' } as unknown as InputHTMLAttributes<HTMLInputElement>
  return (
    <>
      <div className="hint">导入到 {selectors.scopeCrumb(state.scope, state.meta)}。文件会被解析为 SKILL.md，重名自动跳过。</div>
      <div className="pick-row">
        <button className="btn" data-skpick="file" onClick={() => pick(false)}>选择 .md / .zip 文件</button>
        <button className="btn" data-skpick="dir" onClick={() => pick(true)}>选择技能目录</button>
      </div>
      <input ref={fileRef} id="skillFileInput" type="file" multiple accept=".md,.zip" hidden
        onChange={(e) => onChange(e, false)} />
      <input ref={dirRef} id="skillDirInput" type="file" multiple hidden
        {...dirProps} onChange={(e) => onChange(e, true)} />
    </>
  )
}

function Migrate({ m }: { m: MigrateModal }) {
  const { state, actions, selectors } = useAppViewModel()
  const workspaces = state.meta.workspaces
  const ws = selectors.currentWsId(state.scope, state.meta)
  const targets = workspaces.filter((w) => w.id !== ws)
  const list = selectors.visibleSkills(state)
  const toggle = (name: string) => {
    const i = m.checked.indexOf(name)
    const checked = i < 0 ? m.checked.concat([name]) : m.checked.filter((x) => x !== name)
    actions.updateModal({ checked })
  }
  return (
    <>
      <div className="f-row"><label>源作用域</label><span>{selectors.scopeCrumb(state.scope, state.meta)}</span></div>
      <div className="f-row"><label htmlFor="migTarget">目标工作区</label>
        <select id="migTarget" value={m.target} onChange={(e) => actions.updateModal({ target: e.target.value })}>
          <option value="">— 选择 —</option>
          {targets.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      </div>
      <div className="f-row"><label>说明</label><span className="muted">复制到目标工作区；全局定义保留，目标已有同名技能时跳过。</span></div>
      <div className="f-row col"><label>技能</label>
        <div className="mig-list">
          {list.length === 0 && <div className="sub-empty">当前作用域没有技能</div>}
          {list.map((s) => (
            <label key={s.name} className="mig-check">
              <input type="checkbox" data-migskill checked={m.checked.indexOf(s.name) >= 0} onChange={() => toggle(s.name)} />
              <span>{s.label || s.name}</span><span className="muted">/ {s.name} · {selectors.formatKB(s.bytes)} KB</span>
            </label>
          ))}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => actions.closeModal()}>取消</button>
        <button className="btn primary" data-migrun onClick={() => actions.runMigrate()}>执行复制</button>
      </div>
    </>
  )
}

function ServerForm({ m }: { m: ServerFormModal }) {
  const { state, actions, selectors } = useAppViewModel()
  const initial = m.editing ? (selectors.resolvedServer(state, m.editing) ?? null) : null
  const editing = initial !== null
  const [form, setForm] = useState<ServerFormState>(() => (editing && initial ? serverFormFrom(initial) : defaultServerForm()))
  const [deletedEnv, setDeletedEnv] = useState<Set<string>>(() => new Set())
  const [deletedHeaders, setDeletedHeaders] = useState<Set<string>>(() => new Set())
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // 只在第一次提交之后才把空 URL 标红，否则刚打开新建表单就满屏红字。
  const [submitAttempted, setSubmitAttempted] = useState(false)
  // 删 key 的二次确认态：值是 kind + ":" + key（env 与 headers 可能同名）。
  const [confirmSecret, setConfirmSecret] = useState('')
  // 确认态 4s 后自动放弃：点过一次又不想删，过一会儿再点同一个键应当重新确认。
  useEffect(() => {
    if (confirmSecret === '') return
    const timer = setTimeout(() => setConfirmSecret(''), 4000)
    return () => clearTimeout(timer)
  }, [confirmSecret])

  const set = (patch: Partial<ServerFormState>) => setForm((prev) => ({ ...prev, ...patch }))
  const trimmedName = form.serverName.trim()
  const nameIssue = trimmedName === ''
    ? '请填写名称'
    : MCP_NAME_RE.test(trimmedName)
      ? null
      : '只能包含字母、数字、下划线或连字符，1-32 位（不支持空格、点、中文）'
  const urlText = form.url.trim()
  const urlMissing = form.transport === 'http' && urlText === '' && submitAttempted
  const urlInvalid = form.transport === 'http' && urlText !== '' && !/^https?:\/\//i.test(urlText)
  const envKeys = editing && initial && Array.isArray(initial.envKeys) ? initial.envKeys.filter((key: string) => !deletedEnv.has(key)) : []
  const headerKeys = editing && initial && Array.isArray(initial.headerKeys) ? initial.headerKeys.filter((key: string) => !deletedHeaders.has(key)) : []

  const submit = () => {
    setSubmitAttempted(true)
    // 配置无效就停在表单里：让一条连不上、也改不回来的行落盘，比报错更糟。
    const pendingUrl = form.url.trim()
    if (nameIssue !== null) return
    if (form.transport === 'http' && (pendingUrl === '' || !/^https?:\/\//i.test(pendingUrl))) return
    // 「Bearer 令牌」不是独立字段：保存时并成一行 Authorization=Bearer …（支持 ${ENV}）。
    let toSave = form
    const token = form.authToken.trim()
    if (form.transport === 'http' && form.authMode === 'bearer' && token !== '') {
      const kept = form.headersText.split('\n').filter((line) => line.trim() !== '' && !/^\s*Authorization\s*[=:]/i.test(line))
      toSave = { ...form, headersText: [...kept, 'Authorization=Bearer ' + token].join('\n') }
    }
    actions.saveServer(buildServerInput(toSave, deletedEnv, deletedHeaders), m.editing)
  }

  const label = (text: string) => <span className="MCP_label">{text}</span>
  const field = (text: string, node: ReactNode, wide: boolean, hint?: { text: string; error?: boolean } | null) => (
    <label className="MCP_field" data-wide={wide ? 'true' : undefined}>
      {label(text)}
      {node}
      {hint ? <span className="MCP_hint" data-error={hint.error ? 'true' : undefined} role={hint.error ? 'alert' : undefined}>{hint.text}</span> : null}
    </label>
  )
  const textInput = (value: string, onChange: (value: string) => void, placeholder = '') => (
    <input className="MCP_input" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  )
  const textArea = (value: string, onChange: (value: string) => void, placeholder = '') => (
    <textarea className="MCP_textarea" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  )
  // 已配置的 key 只显示名字——值根本不读出；删除要二次确认，避免手滑删掉在用的凭证。
  const secretEditor = (
    keys: string[],
    deleted: Set<string>,
    setDeleted: (next: Set<string>) => void,
    text: string,
    setText: (value: string) => void,
    placeholder: string,
    kind: 'env' | 'headers',
  ) => (
    <>
      {keys.length > 0 ? (
        <div className="MCP_secretKeys" data-role="secret-keys" data-secret-kind={kind}>
          <span className="MCP_hint" data-role="secret-note">
            {(kind === 'headers' ? '已配置 {count} 个请求头（值不读出，留空即保留）' : '已配置 {count} 个环境变量（值不读出，留空即保留）').replace('{count}', String(keys.length))}
          </span>
          {keys.map((key) => {
            const token = kind + ':' + key
            const asked = confirmSecret === token
            return (
              <span key={key} className="MCP_key" data-confirm={asked ? 'true' : undefined}>
                {key}
                <button
                  type="button"
                  title={asked ? '再点一次才会删除这个键，点别处取消' : undefined}
                  onClick={() => {
                    if (!asked) { setConfirmSecret(token); return }
                    setConfirmSecret('')
                    const next = new Set(deleted)
                    next.add(key)
                    setDeleted(next)
                  }}
                >
                  {asked ? '确认删除' : '删除'}
                </button>
              </span>
            )
          })}
        </div>
      ) : null}
      {textArea(text, setText, placeholder)}
    </>
  )

  const fields: ReactNode[] = [
    field('名称', textInput(form.serverName, (value) => set({ serverName: value }), 'MCP Server'), false,
      nameIssue === null
        ? { text: '只能包含字母、数字、下划线或连字符，1-32 位（不支持空格、点、中文）', error: false }
        : { text: nameIssue, error: true }),
    field('调用方式', (
      <div className="MCP_transportRow">
        <button type="button" className="MCP_transportBtn" data-active={form.transport === 'stdio' ? 'true' : 'false'} onClick={() => set({ transport: 'stdio' })}>STDIO</button>
        <button type="button" className="MCP_transportBtn" data-active={form.transport === 'http' ? 'true' : 'false'} onClick={() => set({ transport: 'http' })}>HTTP</button>
      </div>
    ), false),
  ]
  if (form.transport === 'stdio') {
    fields.push(field('命令', textInput(form.command, (value) => set({ command: value }), 'npx'), true))
    fields.push(field('参数（每行一个）', textArea(form.argsText, (value) => set({ argsText: value }), '-y\n@modelcontextprotocol/server-github'), true))
    fields.push(field('环境变量（每行 键=值；已配置的键留空保持不变）',
      secretEditor(envKeys, deletedEnv, setDeletedEnv, form.envText, (value) => set({ envText: value }), 'GITHUB_TOKEN=${GITHUB_TOKEN}', 'env'),
      true, { text: '值里写 ${NAME} 即读取环境变量 NAME（DSH 只认 !!js 表达式，面板自动格式化成 !!js \'`${process.env.NAME}`\'）。stdio 服务器的令牌没有单独的认证项——写在这里的环境变量里（例如 GITHUB_TOKEN=…），stdio 子进程只继承这些显式变量。', error: false }))
    fields.push(field('工作目录（留空使用默认）', textInput(form.cwd, (value) => set({ cwd: value }), 'C:/projects/my-mcp-server'), false))
  } else {
    fields.push(field('服务器地址', textInput(form.url, (value) => set({ url: value }), 'https://example.com/mcp'), true,
      urlInvalid
        ? { text: '地址必须以 http:// 或 https:// 开头', error: true }
        : urlMissing
          ? { text: '请填写服务器地址', error: true }
          : { text: '完整地址，例如 https://example.com/mcp', error: false }))
    fields.push(field('认证', (
      <div className="MCP_authBox">
        <div className="MCP_transportRow">
          <button type="button" className="MCP_transportBtn" data-active={form.authMode === 'none' ? 'true' : 'false'} onClick={() => set({ authMode: 'none' })}>无</button>
          <button type="button" className="MCP_transportBtn" data-active={form.authMode === 'bearer' ? 'true' : 'false'} onClick={() => set({ authMode: 'bearer' })}>Bearer 令牌</button>
          <button type="button" className="MCP_transportBtn" data-active={form.authMode === 'oauth' ? 'true' : 'false'} onClick={() => set({ authMode: 'oauth' })}>OAuth 登录</button>
        </div>
        {form.authMode === 'bearer' ? textInput(form.authToken, (value) => set({ authToken: value }), 'eyJ… 或 ${MCP_TOKEN}') : null}
        <span className="MCP_hint">
          {form.authMode === 'bearer'
            ? '会写成 Authorization=Bearer <令牌>；令牌里可以写 ${ENV} 读取环境变量。'
            : form.authMode === 'oauth'
              ? '保存后在这一行的卡片上点「OAuth 登录」，由面板跑完授权并把令牌写进 Authorization。'
              : '不额外加认证头（有些内网服务器不需要）。'}
        </span>
      </div>
    ), true))
    fields.push(field('请求头（每行 键=值；已配置的键留空保持不变）',
      secretEditor(headerKeys, deletedHeaders, setDeletedHeaders, form.headersText, (value) => set({ headersText: value }), 'Authorization=Bearer ${MCP_TOKEN}', 'headers'),
      true, { text: '值里写 ${NAME} 即读取环境变量 NAME（DSH 只认 !!js 表达式，面板自动格式化成 !!js \'`${process.env.NAME}`\'）。', error: false }))
  }
  fields.push((
    <div className="MCP_field" data-wide="true" key="advanced">
      <button type="button" className="MCP_advancedToggle" onClick={() => setAdvancedOpen((value) => !value)}>
        {(advancedOpen ? '▾ ' : '▸ ') + '高级设置'}
      </button>
    </div>
  ))
  if (advancedOpen) {
    fields.push(field('启动失败时报错', (
      <label className="MCP_checkRow">
        <input type="checkbox" checked={!!form.failOnStartup} onChange={(event) => set({ failOnStartup: event.target.checked })} />
        启动失败时报错
      </label>
    ), false))
    fields.push(field('自动重连', (
      <label className="MCP_checkRow">
        <input type="checkbox" checked={!!form.reconnectEnabled} onChange={(event) => set({ reconnectEnabled: event.target.checked })} />
        自动重连
      </label>
    ), false))
    fields.push(field('单次调用超时', textInput(form.timeout, (value) => set({ timeout: value }), '60000'), false))
    fields.push(field('首次重连延迟', textInput(form.initialDelay, (value) => set({ initialDelay: value }), '500'), false))
    fields.push(field('最大重连延迟', textInput(form.maxDelay, (value) => set({ maxDelay: value }), '30000'), false))
    fields.push(field('最大重连次数', textInput(form.maxAttempts, (value) => set({ maxAttempts: value }), '10'), false))
  }

  // 把「配置本身无效」和「连不上」分开——用户要做的下一件事完全不同。
  const errorRaw = m.error ? String(m.error).replace(/\s+/g, ' ').trim() : ''
  let errorKind = 'other'
  let errorText = errorRaw
  if (errorRaw !== '') {
    if (/配置|无效|invalid|schema|yaml/i.test(errorRaw)) {
      errorKind = 'config'
      errorText = '配置无效 · ' + errorRaw
    } else if (/连接|fetch|network|ECONN|ETIMEDOUT|超时|timeout/i.test(errorRaw)) {
      errorKind = 'connect'
      const target = form.transport === 'http' ? form.url : form.command
      errorText = '连接失败 · ' + (target || 'MCP Server') + ' · ' + errorRaw
    } else {
      errorText = '保存失败 · ' + errorRaw
    }
  }

  return (
    <>
      <div className="MCP_form">
        {fields.map((node, index) => <Fragment key={index}>{node}</Fragment>)}
      </div>
      {errorRaw !== '' ? (
        <div className="form-err" data-kind="error" data-error-kind={errorKind} role="alert">{errorText}</div>
      ) : null}
      <div className="modal-foot">
        <button className="btn" onClick={() => actions.closeModal()}>取消</button>
        <button className="btn primary" data-saveserver disabled={nameIssue !== null || urlMissing || urlInvalid} onClick={submit}>保存</button>
      </div>
    </>
  )
}

function TrustPrompt({ m }: { m: WorkspaceTrustModal }) {
  const { state, actions } = useAppViewModel()
  const ws = state.meta.workspaces.find((w) => w.id === m.wsId)
  return (
    <>
      <div className="hint">首次打开这个工作区。它的 <code>.dsh</code> 配置可能包含 MCP 启动命令与本地技能，是否信任并加载？</div>
      <dl className="meta-grid">
        <dt>工作区</dt><dd>{ws ? ws.title : m.wsId}</dd>
        <dt>路径</dt><dd>{ws ? ws.path : '—'}</dd>
      </dl>
      <div className="hint">信任只影响是否加载该工作区的配置，不会改变全局配置。你可以随时在作用域栏重新打开。</div>
      <div className="modal-foot">
        <button className="btn" data-trust="decline" onClick={() => actions.declineTrust(m.wsId)}>暂不信任</button>
        <button className="btn primary" data-trust="accept" onClick={() => actions.trustWorkspace(m.wsId)}>信任并加载</button>
      </div>
    </>
  )
}

function Raw({ m }: { m: RawModal }) {
  const { actions } = useAppViewModel()
  return (
    <>
      <div className="hint">服务器 {m.serverName} 的宿主原始配置，仅供查看；编辑请使用「编辑配置」。修改会由宿主校验并写回。</div>
      <textarea id="fRaw" className="raw-text" value={m.text} readOnly />
      <div className="modal-foot">
        <button className="btn" onClick={() => actions.closeModal()}>关闭</button>
      </div>
    </>
  )
}

export default function Modals() {
  const { state, actions } = useAppViewModel()
  const m = state.modal
  const mType = m ? m.type : null
  const modalRef = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!mType) return
    prevFocus.current = document.activeElement as HTMLElement | null
    const node = modalRef.current
    const first = node && (
      node.querySelector<HTMLElement>('.modal-body button, .modal-body input:not([hidden]), .modal-body select, .modal-body textarea')
      || node.querySelector<HTMLElement>('button')
    )
    if (first) first.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { actions.closeModal(); return }
      if (e.key === 'Tab' && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>('button, input:not([hidden]), select, textarea'))
          .filter((el) => !(el as HTMLButtonElement).disabled)
        if (!items.length) return
        const head = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === head) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); head.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (prevFocus.current) prevFocus.current.focus()
    }
  }, [mType])

  if (!m) return null
  const titles: Record<string, string> = {
    skillAdd: '添加技能',
    migrate: '复制技能到工作区',
    serverForm: m.type === 'serverForm' && m.editing ? '编辑 MCP 服务器' : '添加 MCP 服务器',
    raw: '原始配置',
    workspaceTrust: '信任此工作区？',
  }
  return (
    <div className="modal-mask" data-modalclose onMouseDown={(e) => { if (e.target === e.currentTarget) actions.closeModal() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" ref={modalRef}>
        <div className="modal-head"><strong id="modalTitle">{titles[m.type] || '编辑'}</strong>
          <button className="icon-btn" onClick={() => actions.closeModal()} aria-label="关闭">×</button></div>
        <div className="modal-body">
          {m.type === 'skillAdd' && <SkillAdd />}
          {m.type === 'migrate' && <Migrate m={m} />}
          {m.type === 'serverForm' && <ServerForm m={m} />}
          {m.type === 'raw' && <Raw m={m} />}
          {m.type === 'workspaceTrust' && <TrustPrompt m={m} />}
        </div>
      </div>
    </div>
  )
}
