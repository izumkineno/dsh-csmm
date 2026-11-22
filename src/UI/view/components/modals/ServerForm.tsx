import { Fragment, useEffect, useState, type ReactNode } from 'react'
import type { ServerFormModal } from '../../../contracts'
import { MCP_NAME_RE, buildServerInput, defaultServerForm, serverFormFrom, type ServerFormState } from '../../../viewmodel/serverForm'
import { useAppViewModel } from '../../../viewmodel/useAppViewModel'

export function ServerForm({ m }: { m: ServerFormModal }) {
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

