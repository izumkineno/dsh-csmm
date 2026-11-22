// 所有「演示：」文案集中在这里；接真实宿主时由 HostPort.bootstrap 提供替代文案。
import type { CopyStrings } from '../contracts'

export const COPY: CopyStrings = {
  skillDir: '演示：已把技能目录路径复制到剪贴板',
  refreshServers: '演示：已刷新服务器状态',
  newSkillText: '（演示）SKILL.md 正文由宿主校验后落盘。',
  newSkillDesc: '演示：刚添加的技能',
  oauthOn: '演示：OAuth 已登录，令牌已存',
  oauthOff: '演示：已断开登录，令牌已清',
  serverSaved: '（演示：等待热加载）',
  rawSaved: '演示：原文已交给宿主校验并保存',
  formTesting: '演示：连接测试中……',
  restart: '演示：已发送重启连接指令',
  configEdit: '演示：打开 MCP 配置文件',
  toolSaved: '（演示：已写入宿主配置）。',
  appTag: '演示环境 · 三页签：提示词 / 技能 / MCP',
  scopeHint: '分组是唯一的可见性白名单；三个页签共用左侧作用域与右侧生效预览，各自编辑自己的那一层',
}
