import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ConnectionOutcome, PromptSectionView, RpcRequest } from '../shared/types'
import type { CsmmService } from './service'

export interface RpcDeps {
  service(workspaceRoot?: string): Promise<CsmmService>
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
      const service = await deps.service(request.workspaceRoot)
      return { status: 200, body: { ok: true, catalog: await service.listDshSkills(request.scope) } }
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
    const code = (error as { code?: string }).code ?? 'E_APPLY'
    return fail(500, code, (error as Error).message ?? String(error))
  }
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
