// Mock 宿主实现：演示数据、连接延迟与伪造的设备副作用都止步于此目录。
import type { Bootstrap, ConnectionOutcome, HostPort, McpServer, Tool } from '../contracts'
import { COPY } from './copy'
import {
  initialActiveGroup,
  makeCustoms,
  makeGroups,
  makeServers,
  makeSkills,
  sections,
  workspaces,
} from './fixtures'

const FALLBACK_TOOLS: Tool[] = [
  { name: 'list_issues', on: true },
  { name: 'get_issue', on: true },
  { name: 'create_issue', on: false },
  { name: 'search_code', on: true },
]

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function createMockHost(): HostPort {
  return {
    bootstrap(): Bootstrap {
      return {
        workspaces,
        sections,
        skills: makeSkills(),
        servers: makeServers(),
        groups: makeGroups(),
        customs: makeCustoms(),
        activeGroup: { ...initialActiveGroup },
        copy: COPY,
      }
    },

    async testConnection(server: McpServer): Promise<ConnectionOutcome> {
      await sleep(600)
      const tools = server.tools.length ? server.tools : FALLBACK_TOOLS
      const on = tools.filter((tool) => tool.on).length
      return {
        status: 'connected',
        tools,
        message: '连接成功，发现 ' + tools.length + ' 个工具（' + on + ' 个开启）。',
        toast: '连接成功，发现 ' + tools.length + ' 个工具',
      }
    },
  }
}
