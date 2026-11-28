import type { Actions, Group, McpServer, Scope, Skill, SkillDraft } from '../../contracts'
import { scopeKey, selectors } from '../../model/selectors'
import { MAX_SKILL_TEXT_BYTES, buildWorkspaceSkillFromDsh, byteLengthUtf8, parseSkillMarkdown, selectSkillSources } from '../../../shared/skillMarkdown'
import type { ActionContext } from '../action-context'
import { copyGroups, copyServer, currentDef, ensureServer, ensureSkill, removeGroupRefs, resolveServer, resolveSkill } from '../helpers'

const draftFromRecord = (skill: Skill): SkillDraft => ({
  label: skill.label,
  desc: skill.desc,
  text: skill.text,
  model: skill.model,
  user: skill.user,
})

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createResourceActions(
  ctx: ActionContext,
): Pick<Actions, 'toggleSkill' | 'setSkDelConfirm' | 'deleteSkill' | 'moveSkill' | 'openSkillDir' | 'addSkillsFromFiles' | 'refreshServers' | 'toggleTool' | 'setAllTools' | 'saveToolList' | 'testConnection' | 'toggleMcp' | 'oauthToggle' | 'deleteMcp' | 'setMcpDelConfirm' | 'restartConnection' | 'setSkillDraft' | 'setDshSourceText' | 'revertSkill' | 'saveSkill' | 'copyDshSkillToWorkspace' | 'saveDshSkillSource' | 'reloadDshSkillSource' | 'retryGroupAppend'> {
  const { mutate, getState, sync, syncMany, pushToast, toast, host } = ctx

  /** 只把技能追加到当前工作区本层生效组；继承的全局组绝不在本层复制或修改。 */
  const appendSkillToLocalGroup = async (name: string): Promise<{ ok: boolean; group?: Group; error?: string }> => {
    const s = getState()
    const wsId = s.scope.kind === 'workspace' ? s.scope.id : null
    const group = selectors.localCurrentGroup(s)
    if (!wsId || !group) return { ok: false, error: '当前没有本层生效配置集' }
    const next = copyGroups([group])[0]
    if (!next.items.some((item) => item.kind === 'skill' && item.name === name)) {
      next.items.push({ kind: 'skill', name })
    }
    const result = await syncMany([{
      type: 'group.save',
      scope: { kind: 'workspace', id: wsId },
      group: next,
    }], { continueOnError: false })
    if (result.failed.length) return { ok: false, group, error: result.failed[0].error }
    return { ok: true, group }
  }

  const retryAppend = async (name: string): Promise<void> => {
    const result = await appendSkillToLocalGroup(name)
    if (result.ok) toast('已加入配置集「' + (result.group?.name ?? '') + '」')
    else toast('加入配置集失败：' + (result.error ?? '未知错误'))
  }

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
    async addSkillsFromFiles(files, fromFolder) {
      const list = Array.from(files || [])
      if (!list.length) {
        toast('没有选中文件')
        return
      }
      const scope = { ...getState().scope }
      const scopeLabel = scope.kind === 'global' ? '全局' : '当前工作区'
      const byPath = new Map<string, File>()
      for (const file of list) byPath.set(file.webkitRelativePath || file.name, file)
      const selection = selectSkillSources(list.map((file) => ({
        path: file.webkitRelativePath || file.name,
        size: file.size,
      })))
      let skipped = 0
      let failed = selection.rejected.length
      const commands: Record<string, unknown>[] = []
      const commandNames: string[] = []
      const seen = new Set<string>()
      for (const picked of selection.picked) {
        const file = byPath.get(picked.path)
        if (!file) { failed += 1; continue }
        try {
          const raw = await file.text()
          const parsed = parseSkillMarkdown(raw, picked.fallbackName)
          const name = parsed.name
          if (!name) { failed += 1; continue }
          const exists = getState().skills.some((skill) => skill.name === name && (scope.kind === 'global'
            ? skill.scope === 'global'
            : skill.scope === 'workspace' && skill.wsId === scope.id))
          if (exists || seen.has(name)) { skipped += 1; continue }
          if (byteLengthUtf8(parsed.text) > 800_000) { failed += 1; continue }
          seen.add(name)
          const skill: Skill = {
            name,
            label: name,
            scope: scope.kind === 'global' ? 'global' : 'workspace',
            wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined,
            bytes: byteLengthUtf8(parsed.text),
            model: parsed.model,
            user: parsed.user,
            desc: parsed.description,
            text: parsed.text,
            enabled: true,
            ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
          } as Skill
          commands.push({ type: 'skill.save', scope, skill })
          commandNames.push(name)
        } catch {
          failed += 1
        }
      }
      let saved = 0
      if (commands.length) {
        const result = await syncMany(commands, { continueOnError: true })
        const failedIndexes = new Set(result.failed.map((item) => item.index))
        const savedNames = commandNames.filter((_, index) => !failedIndexes.has(index))
        saved = result.applied
        failed += result.failed.length
        if (saved > 0 && scopeKey(getState().scope) === scopeKey(scope) && savedNames.length) {
          const lastName = savedNames[savedNames.length - 1]
          mutate((s) => { s.selected.skill = { kind: 'skill', name: lastName } })
        }
      }
      const parts = ['已添加 ' + saved + ' 个技能到' + scopeLabel]
      if (skipped) parts.push('跳过 ' + skipped + ' 个同名')
      if (failed) parts.push('失败 ' + failed + ' 个')
      if (saved > 0) {
        const state = getState()
        parts.push(selectors.localCurrentGroup(state)
          ? '当前生效配置集不会自动加入，请在配置集中勾选后生效'
          : '当前没有生效配置集，保存后不会注入')
      }
      toast(parts.join('；'))
    },
    setSkillDraft(name, patch) {
      const state = getState()
      const record = currentDef(state.skills, state, name) ?? resolveSkill(state, name)
      if (!record) return
      mutate((s) => {
        const base = s.skillDrafts[name] ?? draftFromRecord(record)
        s.skillDrafts[name] = { ...base, ...patch }
      })
    },
    setDshSourceText(text) {
      mutate((s) => { s.sourceState = { ...s.sourceState, raw: text } })
    },
    revertSkill(name) {
      mutate((s) => { delete s.skillDrafts[name] })
    },
    async saveSkill(name) {
      const state = getState()
      const record = currentDef(state.skills, state, name) ?? resolveSkill(state, name)
      if (!record) { toast('技能不存在：' + name); return }
      const draft = state.skillDrafts[name] ?? draftFromRecord(record)
      const local = currentDef(state.skills, state, name)
      const base: Skill | null = local ?? (state.scope.kind === 'workspace'
        ? { ...record, scope: 'workspace', wsId: state.scope.id ?? undefined }
        : record)
      if (!base) { toast('技能不存在：' + name); return }
      mutate((s) => { ensureSkill(s, name) })
      const scope: Scope = base.scope === 'global'
        ? { kind: 'global', id: null }
        : { kind: 'workspace', id: base.wsId }
      const skill: Skill = {
        ...base,
        label: draft.label,
        desc: draft.desc,
        text: draft.text,
        model: draft.model,
        user: draft.user,
        bytes: byteLengthUtf8(draft.text),
      }
      const result = await syncMany([{ type: 'skill.save', scope, skill }], { continueOnError: false })
      if (result.failed.length) { toast('保存技能失败：' + result.failed[0].error); return }
      mutate((s) => { delete s.skillDrafts[name] })
      toast('已保存技能 ' + name)
    },
    async copyDshSkillToWorkspace(name) {
      const state = getState()
      const dsh = selectors.dshSkill(state, name)
      if (!dsh) { toast('DSH 技能不存在：' + name); return }
      if (dsh.origin !== 'global') { toast('只有全局 DSH 技能可以复制到工作区'); return }
      const wsId = state.scope.kind === 'workspace' ? state.scope.id : null
      if (!wsId) { toast('请先切换到目标工作区'); return }
      const existing = state.skills.find((skill) => skill.name === name && skill.scope === 'workspace' && skill.wsId === wsId)
      if (existing) {
        mutate((s) => {
          s.selected.skill = { kind: 'skill', name }
          s.dshDoc = { status: 'idle' }
          s.sourceState = { status: 'idle' }
        })
        toast('当前工作区已有同名插件技能，已选中')
        return
      }
      if (!host.getDshSkill) { toast('宿主未提供技能正文接口'); return }
      const scope: Scope = { kind: 'workspace', id: wsId }
      try {
        let detail = state.dshDoc.status === 'ready' && state.dshDoc.name === name ? state.dshDoc.detail : undefined
        if (!detail || !detail.sha256) {
          const loaded = await host.getDshSkill(name, scope)
          if (!loaded.skill) { toast('读取 DSH 技能失败：' + (loaded.errors[0] ?? '正文为空')); return }
          detail = loaded.skill
        }
        let before = detail.sha256
        if (!before) before = await sha256Text(detail.content)
        if (!before) { toast('无法校验源技能 SHA-256，已取消复制'); return }
        const skill = buildWorkspaceSkillFromDsh(detail, wsId)
        const saved = await syncMany([{ type: 'skill.save', scope, skill }], { continueOnError: false })
        if (saved.failed.length) { toast('保存副本失败：' + saved.failed[0].error); return }
        const afterResult = await host.getDshSkill(name, scope)
        const afterDetail = afterResult.skill
        const after = afterDetail ? (afterDetail.sha256 ?? await sha256Text(afterDetail.content)) : undefined
        if (!after || after !== before) {
          const rollback = await syncMany([{ type: 'skill.delete', scope, name }], { continueOnError: false })
          toast(rollback.failed.length
            ? '副本已保存但源已变化，请手动删除副本'
            : '源技能在复制期间被修改，已撤销副本，请重试')
          return
        }
        const localGroup = selectors.localCurrentGroup(getState())
        if (localGroup) {
          const appended = await appendSkillToLocalGroup(name)
          if (appended.ok) toast('已复制并加入配置集「' + (appended.group?.name ?? localGroup.name) + '」')
          else {
            mutate((s) => pushToast(
              s,
              '技能已保存，但加入配置集失败：' + (appended.error ?? '未知错误'),
              '重试加入配置集',
              () => { void retryAppend(name) },
              6000,
            ))
            toast('已复制技能；加入配置集失败')
          }
        } else if (selectors.currentGroup(getState())) {
          toast('已保存；当前生效组继承自全局，不能追加；请新建本地配置集后勾选')
        } else {
          toast('已保存；当前没有生效配置集，技能不会注入；请先在配置集与生效页新建并启用')
        }
        mutate((s) => {
          s.selected.skill = { kind: 'skill', name }
          s.dshDoc = { status: 'idle' }
          s.sourceState = { status: 'idle' }
        })
      } catch (err: unknown) {
        toast('复制技能失败：' + (err instanceof Error ? err.message : String(err)))
      }
    },
    async saveDshSkillSource(name, text) {
      const state = getState()
      const detail = state.dshDoc.status === 'ready' && state.dshDoc.name === name ? state.dshDoc.detail : undefined
      if (!detail || detail.origin !== 'workspace') { toast('只有工作区 DSH 技能支持源文件编辑'); return }
      if (!detail.sha256) { toast('源文件缺少 SHA-256，无法安全保存'); return }
      if (!host.saveDshSkillSource) { toast('宿主未提供源文件保存接口'); return }
      const scope: Scope = { ...state.scope }
      if (scope.kind !== 'workspace' || !scope.id) { toast('保存源文件需要工作区作用域'); return }
      if (!text.trim()) {
        mutate((s) => {
          if (s.dshDoc.name === name) s.sourceState = { status: 'error', name, raw: text, sha256: detail.sha256, error: '源文件正文不能为空' }
        })
        toast('源文件正文不能为空')
        return
      }
      if (byteLengthUtf8(text) > MAX_SKILL_TEXT_BYTES) {
        mutate((s) => {
          if (s.dshDoc.name === name) s.sourceState = { status: 'error', name, raw: text, sha256: detail.sha256, error: '源文件超过 800000 字节' }
        })
        toast('源文件超过 800000 字节')
        return
      }
      const expected = detail.sha256
      mutate((s) => {
        if (s.dshDoc.name === name) s.sourceState = { status: 'saving', name, raw: text, sha256: expected }
      })
      try {
        const saved = await host.saveDshSkillSource(name, text, expected, scope)
        mutate((s) => {
          if (scopeKey(s.scope) !== scopeKey(scope)) return
          if (s.dshDoc.name === name && s.dshDoc.detail) {
            s.dshDoc.detail = { ...s.dshDoc.detail, raw: text, sha256: saved.sha256 }
          }
          s.sourceState = { status: 'saved', name, raw: text, sha256: saved.sha256 }
        })
        toast('源文件已保存；重开会话后生效')
      } catch (err: unknown) {
        if (scopeKey(getState().scope) !== scopeKey(scope)) return
        const code = (err as { code?: string } | null)?.code
        const message = err instanceof Error ? err.message : String(err)
        const conflictSha = /([0-9a-f]{64})/i.exec(message)?.[1] ?? expected
        mutate((s) => {
          if (s.dshDoc.name !== name) return
          s.sourceState = code === 'E_SKILL_CONFLICT'
            ? { status: 'conflict', name, raw: text, sha256: expected, error: message, conflictSha }
            : { status: 'error', name, raw: text, sha256: expected, error: message }
        })
        toast('保存源文件失败：' + message)
      }
    },
    async reloadDshSkillSource(name) {
      if (!host.getDshSkill) { toast('宿主未提供技能正文接口'); return }
      const scope: Scope = { ...getState().scope }
      const key = scopeKey(scope)
      mutate((s) => {
        s.dshDoc = { status: 'loading', name }
        s.sourceState = { status: 'loading', name }
      })
      try {
        const result = await host.getDshSkill(name, scope)
        if (scopeKey(getState().scope) !== key) return
        mutate((s) => {
          if (s.dshDoc.name !== name) return
          if (!result.skill) {
            const error = result.errors[0] ?? '技能正文为空'
            s.dshDoc = { status: 'error', name, error }
            s.sourceState = { status: 'error', name, error }
            return
          }
          const detail = result.skill
          s.dshDoc = { status: 'ready', name, detail, error: null }
          s.sourceState = detail.raw !== undefined
            ? { status: 'ready', name, raw: detail.raw, sha256: detail.sha256 }
            : { status: 'ready', name, sha256: detail.sha256 }
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        mutate((s) => {
          if (s.dshDoc.name !== name) return
          s.dshDoc = { status: 'error', name, error: message }
          s.sourceState = { status: 'error', name, error: message }
        })
      }
    },
    async retryGroupAppend(name) {
      await retryAppend(name)
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
