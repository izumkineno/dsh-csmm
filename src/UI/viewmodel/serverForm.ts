// 添加 / 编辑 MCP 服务器窗口的表单模型：只做纯数据转换与校验规则，不依赖 React。
// 行为对齐 dsh-context-manager 的 McpFormDialog：名称规则、!!js 环境变量、密文只写不读、授权三态、高级重连参数。
import type { McpServer, ServerFormInput, Transport, AuthMode } from '../contracts'

/** 与宿主侧 SERVER_NAME_RE 保持一致。 */
export const MCP_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

export interface ServerFormState {
  serverName: string
  transport: Transport
  command: string
  argsText: string
  envText: string
  cwd: string
  url: string
  headersText: string
  authMode: AuthMode
  authToken: string
  timeout: string
  failOnStartup: boolean
  reconnectEnabled: boolean
  initialDelay: string
  maxDelay: string
  maxAttempts: string
}

const MCP_JS_EXPR_PREFIX = '!!js'
const MCP_ENV_REF_RE = /\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g

function mcpEnvRefs(value: string): string {
  return value.replace(MCP_ENV_REF_RE, (_match, name: string) => '${process.env.' + name + '}')
}

/** 面板里写 ${NAME} 表示读环境变量；宿主只认 !!js 表达式，保存前格式化。 */
function mcpWireScalar(text: string): string {
  const raw = String(text ?? '')
  const trimmed = raw.trim()
  if (trimmed === MCP_JS_EXPR_PREFIX || trimmed.startsWith(MCP_JS_EXPR_PREFIX + ' ')) {
    return raw
  }
  if (trimmed.indexOf('${') === -1) return raw
  if (trimmed.length > 1 && trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return MCP_JS_EXPR_PREFIX + ' ' + mcpEnvRefs(trimmed)
  }
  return MCP_JS_EXPR_PREFIX + ' ' + '`' + mcpEnvRefs(raw) + '`'
}

function mcpParseLines(text: string): string[] {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function mcpParsePairs(text: string, deleted: Set<string>): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const line of mcpParseLines(text)) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    if (key !== '') out[key] = mcpWireScalar(line.slice(index + 1).trim())
  }
  for (const key of deleted) out[key] = null
  return out
}

function mcpNumber(value: string, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function defaultServerForm(): ServerFormState {
  return {
    serverName: '',
    transport: 'stdio',
    command: '',
    argsText: '',
    envText: '',
    cwd: '',
    url: '',
    headersText: '',
    authMode: 'none',
    authToken: '',
    timeout: '60000',
    failOnStartup: false,
    reconnectEnabled: true,
    initialDelay: '500',
    maxDelay: '30000',
    maxAttempts: '10',
  }
}

export function serverFormFrom(server: McpServer): ServerFormState {
  const form = defaultServerForm()
  form.serverName = server.name ?? ''
  form.transport = server.transport === 'http' ? 'http' : 'stdio'
  form.command = server.command ?? ''
  form.argsText = Array.isArray(server.args) ? server.args.join('\n') : ''
  form.cwd = server.cwd ?? ''
  form.url = server.url ?? ''
  form.timeout = String(server.toolCallTimeoutMs ?? 60000)
  form.failOnStartup = !!server.failOnStartupError
  form.reconnectEnabled = server.reconnect?.enabled !== false
  form.initialDelay = String(server.reconnect?.initialDelayMs ?? 500)
  form.maxDelay = String(server.reconnect?.maxDelayMs ?? 30000)
  form.maxAttempts = String(server.reconnect?.maxAttempts ?? 10)
  // 已经有 Authorization 头就默认选中「Bearer 令牌」；令牌本身不回显。
  if (server.auth === 'oauth') form.authMode = 'oauth'
  else if (server.auth === 'bearer' || (server.headerKeys || []).includes('Authorization')) form.authMode = 'bearer'
  else form.authMode = 'none'
  return form
}

export function buildServerInput(
  form: ServerFormState,
  deletedEnv: Set<string>,
  deletedHeaders: Set<string>,
): ServerFormInput {
  const reconnect = {
    enabled: !!form.reconnectEnabled,
    initialDelayMs: mcpNumber(form.initialDelay, 500),
    maxDelayMs: mcpNumber(form.maxDelay, 30000),
    maxAttempts: mcpNumber(form.maxAttempts, 10),
  }
  const common = {
    serverName: String(form.serverName ?? '').trim(),
    transport: form.transport,
    authMode: form.authMode,
    toolCallTimeoutMs: mcpNumber(form.timeout, 60000),
    failOnStartupError: !!form.failOnStartup,
    reconnect,
  }
  if (form.transport === 'http') {
    return {
      ...common,
      url: mcpWireScalar(String(form.url ?? '').trim()),
      headers: mcpParsePairs(form.headersText, deletedHeaders),
      args: [],
      env: {},
    }
  }
  return {
    ...common,
    command: mcpWireScalar(String(form.command ?? '').trim()),
    args: mcpParseLines(form.argsText).map((line) => mcpWireScalar(line)),
    env: mcpParsePairs(form.envText, deletedEnv),
    cwd: mcpWireScalar(String(form.cwd ?? '').trim()),
    headers: {},
  }
}
