import type { Actions, McpServer, Scope, Skill } from '../../contracts'
import { scopeKey, selectors } from '../../model/selectors'
import type { ActionContext } from '../action-context'
import { copyGroups, copyServer, currentDef, ensureServer, ensureSkill, removeGroupRefs, resolveServer, resolveSkill } from '../helpers'

export function createResourceActions(
  ctx: ActionContext,
): Pick<Actions, 'toggleSkill' | 'setSkDelConfirm' | 'deleteSkill' | 'moveSkill' | 'openSkillDir' | 'addSkillsFromFiles' | 'scanSkills' | 'refreshServers' | 'toggleTool' | 'setAllTools' | 'saveToolList' | 'testConnection' | 'toggleMcp' | 'oauthToggle' | 'deleteMcp' | 'setMcpDelConfirm' | 'restartConnection'> {
  const { mutate, getState, sync, pushToast, host } = ctx
  return {
    // ---- 技能管理 ----
    toggleSkill(name) {
      mutate((s) => {
        const sk = ensureSkill(s, name)
        if (!sk) return
        sk.enabled = sk.enabled === false
        pushToast(s, (sk.enabled === false ? '已停用 ' : '已启用 ') + name
          + (sk.scope === 'workspace' ? '（当前工作区）' : '（全局）'))
      })
      const s = getState()
      const local = currentDef(s.skills, s, name)
      const base = local ?? resolveSkill(s, name)
      if (base) {
        const scope: Scope = local
          ? local.scope === 'global'
            ? { kind: 'global', id: null }
            : { kind: 'workspace', id: local.wsId }
          : { ...s.scope }
        sync({
          type: 'skill.save',
          scope,
          skill: {
            ...base,
            scope: scope.kind,
            wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined,
            enabled: (local ? local.enabled !== false : base.enabled !== false) === false,
          },
        })
      }
    },
    setSkDelConfirm(name) { mutate((s) => { s.skDelConfirm = name }) },
    deleteSkill(name) {
      const localBefore = currentDef(getState().skills, getState(), name)
      const scopeBefore = localBefore?.scope === 'global'
        ? { kind: 'global' as const, id: null }
        : localBefore?.scope === 'workspace'
          ? { kind: 'workspace' as const, id: localBefore.wsId }
          : { ...getState().scope }
      mutate((s) => {
        const local = currentDef(s.skills, s, name)
        const snapshot = copyGroups(s.groups)
        if (!local) {
          const resolved = resolveSkill(s, name)
          if (!resolved) return
          if (s.scope.kind === 'workspace') {
            const copy = ensureSkill(s, name)
            if (!copy) return
            copy.enabled = false
            s.skDelConfirm = null
            pushToast(s, '已在本工作区停用 ' + name + '（全局定义仍保留）')
            return
          }
          // 全局定义缺失时不再兜底。
          s.skDelConfirm = null
          return
        }
        const idx = s.skills.findIndex((x) => x === local)
        const removed = s.skills.splice(idx, 1)[0]
        removeGroupRefs(s, 'skill', name, s.scope)
        s.skDelConfirm = null
        s.skillSel = s.skillSel.filter((n) => n !== name)
        if (s.selected.skill?.kind === 'skill' && s.selected.skill.name === name) {
          const vis = selectors.visibleSkills(s)
          s.selected.skill = vis.length ? { kind: 'skill', name: vis[0].name } : null
        }
        pushToast(s, '已删除 ' + name + (local.scope === 'workspace' ? '（当前工作区覆盖）' : '（全局定义）'), '撤销', () => mutate((p) => {
          p.skills.splice(Math.min(idx, p.skills.length), 0, { ...removed })
          p.groups = copyGroups(snapshot)
          p.selected.skill = { kind: 'skill', name }
        }), 6000)
      })
      if (localBefore) {
        sync({ type: 'skill.delete', scope: scopeBefore, name })
      } else if (scopeBefore.kind === 'workspace') {
        const base = resolveSkill(getState(), name)
        if (base) sync({ type: 'skill.save', scope: scopeBefore, skill: { ...base, scope: 'workspace', wsId: scopeBefore.id ?? undefined, enabled: false } })
      }
    },
    moveSkill(name, target) {
      const before = getState()
      const local = currentDef(before.skills, before, name)
      const base = local || resolveSkill(before, name)
      const wsId = before.scope.kind === 'workspace' ? before.scope.id ?? undefined : before.meta.workspaces[0]?.id
      mutate((s) => {
        const local = currentDef(s.skills, s, name)
        const base = local || resolveSkill(s, name)
        if (!base) return
        const wsId = s.scope.kind === 'workspace' ? s.scope.id ?? undefined : s.meta.workspaces[0]?.id
        if (target === 'global') {
          if (s.skills.some((x) => x.name === name && x.scope === 'global')) { pushToast(s, name + ' 已在全局定义中'); return }
          s.skills.push({ ...base, scope: 'global', wsId: undefined })
          pushToast(s, '已复制到全局：' + name)
        } else {
          if (s.skills.some((x) => x.name === name && x.scope === 'workspace' && x.wsId === wsId)) {
            pushToast(s, name + ' 已在当前工作区定义中')
            return
          }
          s.skills.push({ ...base, scope: 'workspace', wsId })
          pushToast(s, '已复制到当前工作区：' + name)
        }
      })
      if (base) {
        const from: Scope = base.scope === 'global'
          ? { kind: 'global', id: null }
          : { kind: 'workspace', id: base.wsId }
        const to: Scope = target === 'global'
          ? { kind: 'global', id: null }
          : { kind: 'workspace', id: wsId }
        sync({ type: 'skill.copy', from, to, names: [name] })
      }
    },
    openSkillDir() { mutate((s) => { pushToast(s, s.copy.skillDir) }) },
    addSkillsFromFiles(files, fromFolder) {
      mutate((s) => {
        const scope = s.scope
        const names: string[] = []
        const list = Array.from(files || [])
        if (fromFolder) {
          const seen: Record<string, boolean> = {}
          list.forEach((f) => {
            const rel = f.webkitRelativePath || f.name
            const top = rel.split('/')[0]
            if (!seen[top]) { seen[top] = true; names.push(top) }
          })
        } else {
          const bundle = list.length === 1 && /\.zip$/i.test(list[0].name)
          if (bundle) names.push(list[0].name.replace(/\.zip$/i, ''))
          else list.forEach((f) => {
            if (!/\.(md|markdown)$/i.test(f.name)) return
            names.push(f.name.replace(/\.(md|markdown)$/i, ''))
          })
        }
        let added = 0
        let skipped = 0
        names.forEach((raw) => {
          const name = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
          if (!name || currentDef(s.skills, s, name)) { skipped += 1; return }
          s.skills.push({
            name, label: raw, scope: scope.kind === 'global' ? 'global' : 'workspace',
            wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined,
            bytes: 1200, model: true, user: true, enabled: true,
            desc: s.copy.newSkillDesc, text: s.copy.newSkillText,
          } as Skill)
          added += 1
        })
        if (added) {
          const vis = selectors.visibleSkills(s)
          s.selected.skill = vis.length ? { kind: 'skill', name: vis[vis.length - 1].name } : null
          pushToast(s, '已添加 ' + added + ' 个技能到' + (scope.kind === 'global' ? '全局' : '当前工作区') + (skipped ? '，跳过 ' + skipped + ' 个' : ''))
        } else {
          pushToast(s, skipped ? '没有可添加的技能（当前作用域已有同名定义）' : '没有选中文件')
        }
      })
    },
    scanSkills() {
      if (getState().scan.status === 'loading') return
      const scan = host.scanSkills
      mutate((s) => {
        s.modal = { type: 'skillScan' }
        s.scan = scan
          ? { status: 'loading', error: null }
          : { status: 'error', error: '宿主未提供技能扫描接口' }
      })
      if (!scan) return
      const scope = { ...getState().scope }
      void scan(scope).then((result) => {
        mutate((s) => {
          s.scan = { status: 'done', result, error: null }
          pushToast(s, '扫描到 ' + result.skills.length + ' 个 DSH 技能')
        })
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        mutate((s) => {
          s.scan = { status: 'error', error: message }
          pushToast(s, '扫描失败：' + message)
        })
      })
    },
    refreshServers() { mutate((s) => { pushToast(s, s.copy.refreshServers) }) },

    // ---- MCP 管理 ----
    toggleTool(serverName, toolName, on) {
      mutate((s) => {
        const srv = ensureServer(s, serverName)
        if (!srv) return
        const tool = srv.tools.find((x) => x.name === toolName)
        if (tool) tool.on = on
        srv.filterDirty = true
      })
      const s = getState()
      const srv = currentDef(s.servers, s, serverName) ?? resolveServer(s, serverName)
      if (srv) {
        const scope: Scope = srv.scope === 'global' ? { kind: 'global', id: null } : { kind: 'workspace', id: srv.wsId }
        sync({ type: 'mcp.tools', scope, name: serverName, tools: srv.tools.map((t) => ({ ...t, on: t.name === toolName ? on : t.on })) })
      }
    },
    setAllTools(serverName, on, names) {
      mutate((s) => {
        const srv = ensureServer(s, serverName)
        if (!srv) return
        const set = names ? new Set(names) : null
        srv.tools.forEach((t) => {
          if (set && !set.has(t.name)) return
          t.on = on
        })
        srv.filterDirty = true
      })
      const s = getState()
      const srv = currentDef(s.servers, s, serverName) ?? resolveServer(s, serverName)
      if (srv) {
        const scope: Scope = srv.scope === 'global' ? { kind: 'global', id: null } : { kind: 'workspace', id: srv.wsId }
        const set = names ? new Set(names) : null
        sync({
          type: 'mcp.tools',
          scope,
          name: serverName,
          tools: srv.tools.map((t) => ({ ...t, on: set && !set.has(t.name) ? t.on : on })),
        })
      }
    },
    saveToolList(serverName) {
      mutate((s) => {
        const srv = currentDef(s.servers, s, serverName) || resolveServer(s, serverName)
        if (!srv) return
        srv.filterDirty = false
        const denied = srv.tools.filter((t) => t.on === false).length
        srv.testMsg = '已保存工具清单：' + denied + ' 个工具 deny' + s.copy.toolSaved
        pushToast(s, '已保存工具清单 · ' + denied + ' 个 deny')
      })
    },
    testConnection(name) {
      let target: McpServer | null = null
      mutate((s) => {
        target = currentDef(s.servers, s, name) || resolveServer(s, name) || null
        if (target && currentDef(s.servers, s, name)) target.testing = true
      })
      if (!target) return
      void host.testConnection(target).then((outcome) => {
        mutate((s) => {
          const srv = currentDef(s.servers, s, name)
          if (srv) {
            srv.testing = false
            srv.tools = outcome.tools.map((t) => ({ ...t }))
            srv.status = outcome.status
            srv.testMsg = outcome.message
          }
          pushToast(s, outcome.toast + (srv ? '' : '（继承定义未被改写）'))
        })
      })
    },
    toggleMcp(name) {
      mutate((s) => {
        const srv = ensureServer(s, name)
        if (!srv) return
        srv.enabled = srv.enabled === false
        srv.testMsg = srv.enabled === false
          ? '已停用：全部 mcp__' + name + '__* 工具从这份定义里消失。'
          : '已启用：工具重新出现在当前作用域链。'
        pushToast(s, (srv.enabled === false ? '已停用 ' : '已启用 ') + name
          + (srv.scope === 'workspace' ? '（当前工作区）' : '（全局）'))
      })
      const s = getState()
      const local = currentDef(s.servers, s, name)
      const base = local ?? resolveServer(s, name)
      if (base) {
        const scope: Scope = s.scope
        sync({
          type: 'mcp.save',
          scope,
          server: { ...base, scope: scope.kind, wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined, enabled: (local ? local.enabled !== false : base.enabled !== false) === false },
        })
      }
    },
    oauthToggle(name) {
      mutate((s) => {
        const srv = ensureServer(s, name)
        if (!srv) return
        srv.oauth = !srv.oauth
        pushToast(s, srv.oauth ? s.copy.oauthOn : s.copy.oauthOff)
      })
      const s = getState()
      const local = currentDef(s.servers, s, name)
      const base = local ?? resolveServer(s, name)
      if (base) {
        const scope: Scope = s.scope
        sync({
          type: 'mcp.save',
          scope,
          server: { ...base, scope: scope.kind, wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined, oauth: base.oauth !== true },
        })
      }
    },
    deleteMcp(name) {
      const localBefore = currentDef(getState().servers, getState(), name)
      const scopeBefore: Scope = localBefore?.scope === 'global'
        ? { kind: 'global', id: null }
        : localBefore?.scope === 'workspace'
          ? { kind: 'workspace', id: localBefore.wsId }
          : { ...getState().scope }
      mutate((s) => {
        const local = currentDef(s.servers, s, name)
        const snapshot = copyGroups(s.groups)
        if (!local) {
          const resolved = resolveServer(s, name)
          if (!resolved) return
          if (s.scope.kind === 'workspace') {
            const copy = ensureServer(s, name)
            if (!copy) return
            copy.enabled = false
            s.mcpDelConfirm = null
            pushToast(s, '已在本工作区停用 ' + name + '（全局定义仍保留）')
            return
          }
          s.mcpDelConfirm = null
          return
        }
        const idx = s.servers.findIndex((x) => x === local)
        const removed = s.servers.splice(idx, 1)[0]
        removeGroupRefs(s, 'mcp', name, s.scope)
        if (s.selected.mcp?.kind === 'mcp' && s.selected.mcp.name === name) {
          const vis = selectors.visibleServers(s)
          s.selected.mcp = vis.length ? { kind: 'mcp', name: vis[0].name } : null
        }
        s.mcpDelConfirm = null
        pushToast(s, '已删除 ' + name + (local.scope === 'workspace' ? '（当前工作区覆盖）' : '（全局定义）'), '撤销', () => mutate((p) => {
          p.servers.splice(Math.min(idx, p.servers.length), 0, copyServer(removed))
          p.groups = copyGroups(snapshot)
          p.selected.mcp = { kind: 'mcp', name }
        }), 6000)
      })
      if (localBefore) {
        sync({ type: 'mcp.delete', scope: scopeBefore, name })
      } else if (scopeBefore.kind === 'workspace') {
        const base = resolveServer(getState(), name)
        if (base) sync({ type: 'mcp.save', scope: scopeBefore, server: { ...base, scope: 'workspace', wsId: scopeBefore.id ?? undefined, enabled: false } })
      }
    },
    setMcpDelConfirm(name) { mutate((s) => { s.mcpDelConfirm = name }) },
    restartConnection() { mutate((s) => { pushToast(s, s.copy.restart) }) },
  }
}
