import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ConnectionOutcome, PromptSectionView, RpcRequest } from '../shared/types'
import type { CsmmService } from './service'

export interface RpcDeps {
  service(workspaceRoot?: string, skillScope?: unknown): Promise<CsmmService>
  skillScope?(): Promise<{ key: unknown; dispose?: () => Promise<void> } | undefined>
  probe?(serverName: string): Promise<ConnectionOutcome>
  onChanged?(): void
  promptList?(sessionId?: string, presetId?: string): Promise<PromptSectionView[]>
}

export interface RpcResult {
  status: number
  body: unknown
}

const MAX_BODY_BYTES = 1_000_000

export async function handleRpc(
  deps: RpcDeps,
  request: RpcRequest & { workspaceRoot?: string },
): Promise<RpcResult> {
  try {
    if (request.method === 'snapshot') {
      const service = await deps.service(request.workspaceRoot)
      return { status: 200, body: { ok: true, snapshot: service.snapshot(request.scope) } }
    }
    if (request.method === 'dispatch') {
      if (!request.command) return fail(400, 'E_PAYLOAD', 'command is required')
      const service = await deps.service(request.workspaceRoot)
      const snapshot = service.dispatch(request.command)
      deps.onChanged?.()
      return { status: 200, body: { ok: true, snapshot } }
    }
    if (request.method === 'promptList') {
      const prompts = deps.promptList ? await deps.promptList(request.sessionId, request.presetId) : []
      return { status: 200, body: { ok: true, prompts } }
    }
    if (request.method === 'skillCatalog') {
      const catalog = await withSkillService(deps, request.workspaceRoot, (service) =>
        service.listDshSkills(request.scope))
      return { status: 200, body: { ok: true, catalog } }
    }
    if (request.method === 'skillDetail') {
      if (!request.skillName) return fail(400, 'E_PAYLOAD', 'skillName is required')
      const detail = await withSkillService(deps, request.workspaceRoot, (service) =>
        service.getDshSkill(request.skillName as string, request.scope))
      return { status: 200, body: { ok: true, detail } }
    }
    if (request.method === 'skillSourceSave') {
      if (
        !request.skillName ||
        typeof request.text !== 'string' ||
        typeof request.expectedSha256 !== 'string' ||
        !request.scope ||
        request.scope.kind !== 'workspace' ||
        !request.scope.id
      ) {
        return fail(400, 'E_PAYLOAD', 'skillName, workspace scope, text and expectedSha256 are required')
      }
      const saved = await withSkillService(deps, request.workspaceRoot, (service) =>
        service.saveDshSkillSource(
          request.skillName as string,
          request.scope as { kind: 'workspace'; id: string },
          request.text as string,
          request.expectedSha256 as string,
        ))
      return { status: 200, body: { ok: true, saved } }
    }
    if (request.method === 'testConnection') {
      if (!request.server) return fail(400, 'E_PAYLOAD', 'server is required')
      if (!deps.probe) {
        return {
          status: 200,
          body: {
            ok: true,
            outcome: {
              status: 'error',
              tools: [],
              message: '宿主未提供 MCP 探测接口',
              toast: '未接入 MCP 探测',
            } satisfies ConnectionOutcome,
          },
        }
      }
      return { status: 200, body: { ok: true, outcome: await deps.probe(request.server.name) } }
    }
    return fail(400, 'E_KIND', `unknown method: ${String(request.method)}`)
  } catch (error) {
    return mapServiceError(error)
  }
}

async function withSkillService<T>(
  deps: RpcDeps,
  workspaceRoot: string | undefined,
  run: (service: CsmmService) => Promise<T>,
): Promise<T> {
  const view = await deps.skillScope?.()
  try {
    return await run(await deps.service(workspaceRoot, view?.key))
  } finally {
    try {
      await view?.dispose?.()
    } catch {
      // releasing a read-only preset scope must not fail the request
    }
  }
}

function mapServiceError(error: unknown): RpcResult {
  const code = (error as { code?: string }).code ?? 'E_APPLY'
  const message = (error as Error).message ?? String(error)
  if (['E_PAYLOAD', 'E_SKILL_TOO_LARGE', 'E_SKILL_ENCODING', 'E_SCHEMA', 'E_PARSE'].includes(code)) {
    return fail(400, code, message)
  }
  if (['E_WORKSPACE_UNTRUSTED', 'E_SOURCE_READONLY', 'E_PATH_ESCAPE', 'E_TRUST'].includes(code)) {
    return fail(403, code, message)
  }
  if (['E_NOT_FOUND', 'E_SOURCE_MISSING'].includes(code)) return fail(404, code, message)
  if (['E_SKILL_CONFLICT', 'E_REVISION'].includes(code)) return fail(409, code, message)
  if (code === 'E_LOCKED') return fail(423, code, message)
  return fail(500, code, message)
}

export function createRpcHandler(
  deps: RpcDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') {
      send(405, { ok: false, error: { code: 'E_PROFILE', message: 'method not allowed' } })
      return
    }
    try {
      const raw = await readBody(req)
      const parsed = JSON.parse(raw) as RpcRequest & { workspaceRoot?: string }
      const result = await handleRpc(deps, parsed)
      send(result.status, result.body)
    } catch (error) {
      send(400, {
        ok: false,
        error: { code: 'E_PARSE', message: (error as Error).message ?? 'bad request' },
      })
    }
  }
}

function fail(status: number, code: string, message: string): RpcResult {
  return { status, body: { ok: false, error: { code, message } } }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
