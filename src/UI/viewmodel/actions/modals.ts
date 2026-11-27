import type { Actions, McpServer, Scope } from '../../contracts'
import type { ActionContext } from '../action-context'
import { copyServer, currentDef, mergeSecrets, resolveServer, resolveSkill } from '../helpers'

export function createModalActions(
  ctx: ActionContext,
): Pick<Actions, 'openModal' | 'closeModal' | 'updateModal' | 'openSkillAdd' | 'openMigrate' | 'runMigrate' | 'openServerForm' | 'saveServer' | 'openRaw' | 'rawSave' | 'trustWorkspace' | 'declineTrust'> {
  const { mutate, getState, sync, pushToast } = ctx
  return {
    openModal(modal) { mutate((s) => { s.modal = modal }) },
    closeModal() { mutate((s) => { s.modal = null }) },
    updateModal(patch) { mutate((s) => { if (s.modal) s.modal = { ...s.modal, ...patch } as typeof s.modal }) },
    openSkillAdd() { mutate((s) => { s.modal = { type: 'skillAdd' } }) },
    openMigrate(preselect) {
      mutate((s) => { s.modal = { type: 'migrate', target: '', checked: preselect || [] } })
    },
    runMigrate() {
      mutate((s) => {
        const m = s.modal
        if (!m || m.type !== 'migrate') return
        if (!m.target) { pushToast(s, '请选择目标工作区'); return }
        if (!m.checked.length) { pushToast(s, '请至少选择一个技能'); return }
        const ws = s.meta.workspaces.find((w) => w.id === m.target)
        let copied = 0
        let skipped = 0
        m.checked.forEach((name) => {
          const base = resolveSkill(s, name)
          if (!base) return
          if (s.skills.some((x) => x.name === name && x.scope === 'workspace' && x.wsId === m.target)) {
            skipped += 1
            return
          }
          s.skills.push({ ...base, scope: 'workspace', wsId: m.target })
          copied += 1
        })
        s.modal = null
        s.skillSel = []
        pushToast(s, '已复制 ' + copied + ' 项到 ' + (ws ? ws.title : m.target) + (skipped ? '，跳过 ' + skipped + ' 项同名定义' : ''))
      })
    },
    openServerForm(srv, isNew) {
      mutate((s) => {
        s.modal = { type: 'serverForm', editing: isNew || !srv ? '' : srv.name }
      })
    },
    saveServer(input, editing) {
      let saved: McpServer | null = null
      mutate((s) => {
        const modal = s.modal
        if (!modal || modal.type !== 'serverForm') return
        const name = input.serverName.trim()
        const local = editing ? currentDef(s.servers, s, editing) : null
        const base = local || (editing ? resolveServer(s, editing) : null)
        if (editing && !base) return
        const collision = currentDef(s.servers, s, name)
        if (collision && collision.name !== editing) {
          s.modal = { ...modal, error: '当前作用域已有同名服务器：' + name }
          return
        }
        let target: McpServer | null = local
        if (!target) {
          if (s.scope.kind === 'workspace' && base) {
            target = { ...copyServer(base), scope: 'workspace', wsId: s.scope.id ?? undefined }
            s.servers.push(target)
          } else if (s.scope.kind === 'workspace') {
            target = {
              name, label: name, scope: 'workspace', wsId: s.scope.id ?? undefined,
              status: 'disconnected', transport: input.transport, tokens: 0, auth: input.authMode,
              enabled: true, tools: [], instructions: '',
            }
            s.servers.push(target)
          } else {
            target = {
              name, label: name, scope: 'global', status: 'disconnected', transport: input.transport,
              tokens: 0, auth: input.authMode, enabled: true, tools: [], instructions: '',
            }
            s.servers.push(target)
          }
        }
        if (!target) return
        target.name = name
        target.label = name
        target.transport = input.transport
        target.auth = input.authMode
        if (input.transport === 'http') {
          target.url = input.url
          delete target.command
          delete target.args
          delete target.cwd
        } else {
          target.command = input.command
          target.args = input.args
          target.cwd = input.cwd || undefined
          delete target.url
        }
        target.env = input.transport === 'stdio' ? mergeSecrets(target.env, input.env) : {}
        target.envKeys = Object.keys(target.env)
        target.headers = input.transport === 'http' ? mergeSecrets(target.headers, input.headers) : {}
        target.headerKeys = Object.keys(target.headers)
        target.toolCallTimeoutMs = input.toolCallTimeoutMs
        target.failOnStartupError = input.failOnStartupError
        target.reconnect = input.reconnect
        if (input.authMode === 'oauth') target.oauth = target.oauth ?? false
        else delete target.oauth
        if (editing && editing !== name) {
          for (const group of s.groups) {
            if (group.scope.kind !== s.scope.kind || group.scope.id !== s.scope.id) continue
            group.items = group.items.map((it) => (it.kind === 'mcp' && it.name === editing ? { kind: 'mcp', name } : it))
          }
          if (s.selected.mcp?.kind === 'mcp' && s.selected.mcp.name === editing) s.selected.mcp = { kind: 'mcp', name }
        }
        if (!local && !editing) {
          s.selected.mcp = { kind: 'mcp', name }
          pushToast(s, '已添加 ' + name + '，点「测试连接」拉工具清单')
        } else {
          pushToast(s, '已保存 ' + name + s.copy.serverSaved + (target.scope === 'workspace' ? '（当前工作区覆盖）' : ''))
        }
        saved = { ...target, tools: target.tools.map((t) => ({ ...t })) }
        s.modal = null
      })
      if (saved) {
        const s = getState()
        const scope: Scope = s.scope
        sync({ type: 'mcp.save', scope, server: saved })
      }
    },
    openRaw(srv) {
      const yaml = 'kind: mcp-server\nserverName: ' + srv.name + '\ntransport: ' + srv.transport + '\n' +
        (srv.transport === 'stdio'
          ? 'command: npx\nargs:\n  - -y\n  - @modelcontextprotocol/server-github\n'
          : 'url: https://api.github.com/mcp\nheaders:\n  Authorization: Bearer <token>\n') +
        'toolCallTimeoutMs: 60000\nmaxInstructionBytes: 8192'
      mutate((s) => { s.modal = { type: 'raw', serverName: srv.name, text: yaml } })
    },
    rawSave() { mutate((s) => { s.modal = null; pushToast(s, s.copy.rawSaved) }) },
    trustWorkspace(wsId) {
      mutate((s) => {
        const ws = s.meta.workspaces.find((w) => w.id === wsId)
        if (ws) ws.trusted = true
        s.trustDeclined = s.trustDeclined.filter((id) => id !== wsId)
        s.modal = null
        pushToast(s, '已信任工作区 ' + (ws ? ws.title : wsId))
      })
      sync({ type: 'trust.set', workspaceId: wsId, trusted: true })
    },
    declineTrust(wsId) {
      mutate((s) => {
        if (!s.trustDeclined.includes(wsId)) s.trustDeclined.push(wsId)
        s.modal = null
        pushToast(s, '已保持受限访问（可随时在左栏重新信任）')
      })
    },
  }
}
