# dsh-csmm

DSH 插件：在「全局 / 工作区」两个作用域里管理提示词段、技能、MCP 服务器，并把生效分组实际注入到每个 agent。

- 面板：DSH 侧边栏 `CSMM`（`sidebar.panellist` + `main`）
- 作用域：`global` 与 `workspace:<id>`，工作区同名定义覆盖全局
- 分组：每作用域一个生效分组；提示词段用开关控制，开 = 注入，关 = 拦截
- 存储：插件自有 JSON store（全局 + 各工作区），带 revision、原子写、备份、锁
- 生效：按 agent 注册提示词段、注册技能、按组过滤装配结果（contexts 与 `dsh-csmm:*` 始终保留）

## 功能

- **分组管理**：每作用域建多个分组，每层一个生效分组；支持继承下层、显式不使用分组（阻断继承）。
- **提示词段开关**：插件自有段（`sections/**/*.md`）+ 宿主注册段（`DSH 注册提示词`）统一列在分组编辑器里；开关只有两态，不存在"空分组是否过滤"的猜测。
- **自定义提示词**：跟随生效分组所在作用域，可逐条启用/停用。
- **技能**：作用域感知定义，工作区可覆盖全局；生效组的技能按 agent 注册进宿主（`source/provider: dsh-csmm`）。
- **MCP 服务器**：按作用域单独定义，工作区继承全局、同名覆盖；工具开关、连接测试（无探针时如实报错）、密钥与配置分离存储。
- **陌生工作区信任**：未信任工作区进入受限模式，只加载全局配置；信任后才读取该工作区定义。
- **上下文预览**：右侧显示生效内容、诊断、token 预算（200K），以及复制生效内容。

## 作用域与信任

- 身份：技能/MCP 按名称解析，工作区定义优先于全局。
- 生效组：`activeGroup[scopeKey]` 缺键 = 继承下层；`''` = 显式不用分组；有 id = 该组生效（含空组）。
- 空组语义：生效组存在即按白名单过滤——开着的段才放行；没有生效组时不过滤。
- `disabledPrompts`：按作用域持久化的禁用段清单，与白名单叠加（禁用优先）。
- 信任：全局 store 记录 `workspaces[].trusted`；受限模式下 `chainFor` 只剩全局，可见集/分组/自定义全部只取全局。

## 数据落盘

```
$DSH_HOME/dsh-csmm/
  store.json        # 全局：分组/自定义/技能/MCP/信任/activeGroup/disabledPrompts/revision
  secrets.json      # 全局密钥（0600，只有宿主可读）
  backups/          # 覆盖前备份，保留最近 10 份
  store.lock        # 写锁
  sections/**/*.md  # 插件自有提示词段（name = 相对路径去 .md）

<workspace-root>/.dsh/<workspace-id>/
  store.json / secrets.json / backups / store.lock   # 同上，工作区作用域
```

- `workspace-id` 来自 `workspaceRegistry.resolveByPath(root)`，不是目录名。
- 写操作：`expectedRevision` 乐观并发 → 临时文件 → 落盘 → 原子改名；冲突报 `E_REVISION`。
- 快照永不含密钥明文；客户端只见 `envKeys/headerKeys`，写回用 `null` 删、`""` 保留。

## 架构

```
src/shared/   类型 + 作用域解析（resolve.ts：winningLayer/visible*/budget/tokenEstimate）
src/host/     宿主：store ｜ service（snapshot/dispatch） ｜ http（RPC） ｜
              materialize（按 agent 注入/过滤） ｜ sections ｜ prompts ｜ paths
src/client/   浏览器侧：hostPort.ts（RemoteHost：load/send/snapshot/dispatch/listPrompts）
src/UI/       面板 MVVM（contracts ｜ model ｜ viewmodel ｜ view）
```

- RPC：`POST /dsh-csmm/rpc`，`{ method: 'snapshot' | 'dispatch' | 'testConnection' | 'promptList' }`。
- `snapshot(scope, workspaceRoot?)` 返回 `{ revision, bootstrap, diagnostics }`。
- `dispatch` 是唯一写通道，共 19 条命令（`src/shared/types.ts` 的 `Command` 联合类型）：
  `group.save/activate/effective/inherit/none/delete`、`custom.save/toggle/delete`、
  `skill.save/toggle/delete/copy`、`mcp.save/toggle/delete/tools`、`prompt.toggle`、`trust.set`。
- 每次 `dispatch` 成功后刷新 materialize；agent 级注册随 agent 释放。
- `promptList(sessionId?, presetId?)`：有 live agent 按 agent 装配，否则按默认 preset 装配，
  返回 sections + contexts + tool schemas（`standard` 下约 144 项）。
- 面板：提示词段 / 工具定义 / 运行上下文行尾的「预览」直接读取 `promptList` 结果，只读展示全文；运行上下文同时计入预算与「生效内容」摘要。

## 安装与运行

1. 构建：`npm run build`（产物 `dist/index.js` + `dist/client.js`）
2. 安装到 profile（二选一）：
   - `dsh plugin --profile web add E:\Code\_dev_skill_mcp\dsh-csmm`
   - 或经 `plugin_manager` 的 `install_bundle`，target 填本目录绝对路径
3. 重启该 profile 的 DSH，打开侧边栏 `CSMM` 面板。

说明：不要手工改 profile 的 `package.json` / `cordis.patch.yml`；bundle 声明在[package.json](package.json)的 `dsh` 段与[cordis.patch.yml](cordis.patch.yml)。

## 开发

```bash
npm install
npm run build        # 宿主 + 客户端打包到 dist/
npm test             # tsx --test tests/shared + tests/host（当前 37 条）
npm run preview:ui   # Vite 预览面板，经代理走真实宿主 RPC
```

- `preview:ui` 把 `/dsh-csmm/rpc` 代理到 `DSH_WEB_ORIGIN`（默认 `http://127.0.0.1:62427`），无 mock 数据；宿主不可达时显示错误与重试。
- 类型检查分三份配置：`tsconfig.host.json` / `tsconfig.ui.json` / `tsconfig.client.json`。
- 注意：`tests/` 下 `mock/model/shared/viewmodel/wiring.test.ts` 是旧夹具，引用已不存在的源码，未纳入 `npm test`；`tsc -p .` 因此仍红，以三份分配置检查为准。

## 验证

- 单测：`npm test`（store 原子写/锁/revision、service snapshot/dispatch、materialize 注入与过滤、resolve 作用域语义）。
- 构建：`npm run build` 成功且 `node --check dist/index.js dist/client.js` 通过。
- 真机：装到 `web` profile 后重启，新建会话，在会话日志的 system prompt 里核对 `dsh-csmm` 段与开关过滤效果。
- 浏览器回归：见 [docs/BROWSER-TEST-MATRIX.md](docs/BROWSER-TEST-MATRIX.md)、[docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md)、[docs/BROWSER-TEST-SOP.md](docs/BROWSER-TEST-SOP.md)。

## 已知限制

- 提示词开关只过滤 `sections`；工具 schema（约 107 项，含 MCP 工具）由工具注册表单独下发，不受段开关影响。要减工具需要按 agent 做 `tools.restrict`，尚未实现。
- MCP 服务器只做配置管理（增删改、工具开关、密钥分离），不做宿主启停与真实连接探测；`testConnection` 在无探针时返回明确错误。
- `sections/` 为空且分组无内容时，面板列表为空是正常状态（无内置演示数据）；`DSH 注册提示词` 列表仍可从宿主读取。
- `.dsh/` 已加入 `.gitignore`，工作区 store 不入库。

## 文档地图

| 文件 | 性质 |
|---|---|
| 本 README | 当前实现的权威说明（安装/行为/存储/开发） |
| [AGENTS.md](AGENTS.md) | agent 入口纪律（部分章节仍引用旧 README 节号，待同步） |
| [SPEC.md](SPEC.md) | 早期双作用域规范草案，仅作设计参考，不再是实现契约 |
| [VSCODE-MAPPING.md](VSCODE-MAPPING.md) | 与 VS Code 配置模型的概念对照，非规范 |
| [docs/BROWSER-TEST-MATRIX.md](docs/BROWSER-TEST-MATRIX.md) | 浏览器测试矩阵（128 例） |
| [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md) | P0 清单 |
| [docs/BROWSER-TEST-SOP.md](docs/BROWSER-TEST-SOP.md) | 浏览器测试 SOP（含环境/夹具/证据规范） |
