// Mock 夹具：唯一的演示数据来源。接真实宿主时整体替换本目录。
import type {
  CustomPrompt,
  Group,
  McpServer,
  Section,
  Skill,
  Workspace,
} from '../contracts'

export const workspaces: Workspace[] = [
  { id: '6d5507b0-80fb-4165-bea5-989dd24639b8', title: 'dsh-context-manager', trusted: true, current: true, path: 'E:\\Code\\_dev_skill_mcp\\dsh-context-manager' },
  { id: 'fa450902-33b0-47e3-83fa-53f8cdf22a20', title: '_TEMP', trusted: false, path: 'E:\\Code\\_TEMP' },
]

// 段是静态清单（界面不修改它）。
export const sections: Section[] = [
  {
    name: 'tool:read', source: '内置工具', tokens: 44, kind: 'section',
    text: 'Use the read tool to inspect a text file. Prefer reading a range over the whole file when the file is large, and never re-read a file you just edited.',
  },
  {
    name: 'tool:bash', source: '内置工具', tokens: 58, kind: 'section',
    text: 'Check the [exit code: N] marker after every command. Use PowerShell syntax on Windows and quote paths containing spaces.',
  },
  {
    name: 'tool:subagent', source: '内置工具', tokens: 52, kind: 'section',
    text: 'Delegate self-contained tasks to a subagent. The child does not share this conversation, so restate every fact it needs. Collect its result before answering.',
  },
  {
    name: 'tool:workflow', source: '内置工具', tokens: 33, kind: 'section',
    text: 'Run a JavaScript workflow script that fans work out across many subagents. Pipeline items have no barrier between stages.',
  },
  {
    name: 'tool:skill', source: '内置技能', tokens: 61, kind: 'section',
    text: 'Call the skill tool to load full instructions for a named skill before acting on a task that names or matches one.',
  },
  {
    name: 'deployment:persona-prefix', source: '人设', tokens: 14, kind: 'section',
    text: 'You are a coding agent powered by the {{model}} model.',
  },
  { name: 'plan:policy', source: '其它插件', tokens: 0, kind: 'section', text: '' },
  {
    name: 'oh-my-dsh:protocol', source: '其它插件', tokens: 4380, kind: 'section',
    text: '（这是一大段插件协议：状态机、路由表、委派规则…… 预览里只截断显示前 400 字）。',
  },
  {
    name: 'harness:identity', source: '其它插件', tokens: 13, kind: 'section',
    text: 'You are an AI agent powered by DeepSeek Harness.',
  },
  {
    name: 'mcp:omd-state', source: 'MCP', tokens: 38, kind: 'mcp-section', server: 'omd-state',
    text: '状态机服务说明：state_read / state_write / graph_run 等工具用于读写 .omd 状态；写操作需带 expectUpdatedAt 做 CAS。',
  },
  {
    name: 'mcp:github', source: 'MCP', tokens: 96, kind: 'mcp-section', server: 'github',
    text: 'GitHub MCP server：仓库搜索、文件读取、issue 与 PR 操作。写操作会真实改变远端仓库，先确认再调用。',
  },
  {
    name: 'working-directory:current', source: '运行上下文', tokens: 26, kind: 'context',
    text: 'Working directory: E:\\Code\\_dev_skill_mcp\\dsh-context-manager',
  },
  {
    name: 'approval:policy', source: '运行上下文', tokens: 31, kind: 'context',
    text: 'Approval policy: never ask; workspace-write sandbox with full access inside the workspace.',
  },
  {
    name: 'sandbox:policy', source: '运行上下文', tokens: 18, kind: 'context',
    text: 'Sandbox: workspace-write. Paths outside the workspace are rejected.',
  },
]

export function makeSkills(): Skill[] {
  return [
    { name: 'office-xlsx', label: 'Excel 表格', scope: 'global', bytes: 4821, model: true, user: true, desc: '创建、读取、编辑与校验 xlsx。', text: 'Load before rendering an Excel workbook. Use openpyxl through the bundled Python; never hand-edit the xml.' },
    { name: 'office-docx', label: 'Word 文档', scope: 'global', bytes: 3910, model: true, user: true, desc: '生成与校验 docx。', text: 'Use python-docx. Keep headings semantic, never fake a heading with bold text.' },
    { name: 'diagram', label: '结构图', scope: 'global', bytes: 2210, model: true, user: true, desc: '散文说不清结构时画最小图。', text: 'Draw only when prose cannot answer: call trees, module maps, diffs.' },
    { name: 'minimal-prose-discipline', label: '简洁文风', scope: 'global', bytes: 1760, model: true, user: true, desc: '对话写作纪律：去 filler，保语义。', text: 'Protected core never rewritten: code, commands, paths, errors, negations, numbers.' },
    { name: 'browser-cdp', label: '浏览器 CDP', scope: 'global', bytes: 5210, model: true, user: true, desc: '复用登录态操作 Chrome。', text: 'Launch Chrome with --remote-debugging-port, reuse the existing profile, then drive via CDP.' },
    { name: 'debug-playbook', label: '排查手册', scope: 'global', bytes: 2880, model: true, user: true, desc: '先取证据再猜。', text: 'Reproduce with the smallest input, read the log before the code.' },
    { name: 'omd-hud', label: 'HUD 状态卡', scope: 'global', bundled: true, bytes: 1180, model: true, user: true, desc: '插件自带：把模式、轮次、todo 渲染成状态卡。', text: 'Render the omd HUD card: mode, round, story, agents, todo.' },
    { name: 'omd-doctor', label: '安装诊断', scope: 'global', bundled: true, bytes: 2360, model: true, user: true, desc: '插件自带：检查宿主版本、注册计数、.omd 可写性。', text: 'Run the omd doctor checklist: host version, registry counts, Config parsing, MCP smoke.' },
    { name: 'repo-conventions', label: '本仓库约定', scope: 'workspace', wsId: workspaces[0].id, bytes: 1420, model: true, user: true, desc: '本仓库的提交与测试约定。', text: 'Run npm run build && npm test before claiming done. Never hand-edit dist.' },
    { name: 'web-research', label: '外部调研', scope: 'workspace', wsId: workspaces[0].id, bytes: 3100, model: true, user: true, desc: 'docs 优先的外部检索流程。', text: 'Prefer official docs; cite the exact URL and the version.' },
    { name: 'scratch-notes', label: '草稿笔记', scope: 'workspace', wsId: workspaces[0].id, bytes: 620, model: false, user: true, desc: '只有人能敲 /scratch-notes 打开。', text: 'Personal scratchpad. Not model invocable.' },
    { name: 'legacy-import', label: '旧导入器', scope: 'workspace', wsId: workspaces[1].id, bytes: 2040, model: true, user: true, desc: '另一个工作区的技能。', text: 'Imports legacy dsh-panel context files.' },
  ]
}

export function makeServers(): McpServer[] {
  const instr = (name: string): string =>
    (sections.find((s) => s.name === 'mcp:' + name) || {}).text || ''
  return [
    {
      name: 'omd-state', label: 'oh-my-dsh 状态', scope: 'global', status: 'connected', transport: 'stdio', tokens: 38, auth: 'none',
      command: 'node dist/mcp-server.js --stdio',
      envKeys: ['MCP_LOG_LEVEL'],
      env: { MCP_LOG_LEVEL: 'debug' },
      instructions: instr('omd-state'),
      tools: [
        { name: 'state_read', on: true }, { name: 'state_write', on: true }, { name: 'state_list_active', on: true },
        { name: 'graph_run', on: true }, { name: 'graph_status', on: true }, { name: 'team_begin', on: false },
        { name: 'team_dispose', on: false }, { name: 'notepad_write_working', on: true }, { name: 'hud_render', on: true },
        { name: 'trace_begin', on: false },
      ],
    },
    {
      name: 'github', label: 'GitHub', scope: 'global', status: 'connected', transport: 'http', tokens: 96, auth: 'oauth', oauth: true,
      url: 'https://api.github.com/mcp',
      headerKeys: ['Authorization'],
      headers: { Authorization: 'Bearer ghp_demo' },
      instructions: instr('github'),
      tools: [
        { name: 'search_code', on: true }, { name: 'get_file_contents', on: true }, { name: 'list_issues', on: true },
        { name: 'create_issue', on: false }, { name: 'list_pull_requests', on: true }, { name: 'get_pull_request', on: true },
        { name: 'create_pull_request', on: false }, { name: 'merge_pull_request', on: false },
      ],
    },
    {
      name: 'figma', label: 'Figma', scope: 'global', status: 'disconnected', transport: 'http', tokens: 0, auth: 'none',
      url: 'https://mcp.figma.com/mcp', instructions: '', tools: [],
    },
    {
      name: 'repo-audit', label: '仓库审计', scope: 'workspace', wsId: workspaces[0].id,
      status: 'connected', transport: 'stdio', tokens: 24, auth: 'none',
      command: 'node scripts/audit-mcp.mjs',
      instructions: '本仓库专用：列出未跟踪文件、构建残留与过期 worktree。',
      tools: [{ name: 'list_stale', on: true }, { name: 'preview_cleanup', on: false }],
    },
  ]
}

export function makeGroups(): Group[] {
  return [
    {
      id: 'g1', name: '日常开发', scope: { kind: 'global' }, enabled: true,
      items: [
        { kind: 'section', name: 'tool:read' }, { kind: 'section', name: 'tool:bash' },
        { kind: 'section', name: 'tool:subagent' }, { kind: 'section', name: 'tool:skill' },
        { kind: 'mcp', name: 'omd-state' }, { kind: 'skill', name: 'office-xlsx' },
        { kind: 'skill', name: 'diagram' }, { kind: 'section', name: 'deployment:persona-prefix' },
        { kind: 'section', name: 'harness:identity' },
      ],
    },
    {
      id: 'g2', name: '精简上下文', scope: { kind: 'global' }, enabled: false,
      items: [{ kind: 'section', name: 'tool:read' }, { kind: 'section', name: 'tool:bash' }],
    },
    {
      id: 'g3', name: '本仓库约定', scope: { kind: 'workspace', id: workspaces[0].id }, enabled: true,
      items: [
        { kind: 'section', name: 'tool:read' }, { kind: 'section', name: 'tool:bash' },
        { kind: 'section', name: 'tool:workflow' }, { kind: 'skill', name: 'repo-conventions' },
        { kind: 'skill', name: 'web-research' }, { kind: 'mcp', name: 'github' }, { kind: 'mcp', name: 'repo-audit' },
      ],
    },
  ]
}

export function makeCustoms(): CustomPrompt[] {
  return [
    { id: 'c1', title: '工作方式', scope: { kind: 'global' }, text: '先读 AGENTS.md 与项目约定，再动手改代码。\n遇到不确定的需求先问，不要猜。' },
    { id: 'c2', title: '输出风格', scope: { kind: 'global' }, text: '回答用中文，短句，先给结论。\n不要复述我已经说过的话。' },
  ]
}

// 初始作用域 -> 分组映射也属于 Mock 配置。
export const initialActiveGroup: Record<string, string> = {
  'global:': 'g1',
  ['workspace:' + workspaces[0].id]: 'g3',
}
