# dsh-csmm

DSH 插件：在「全局 / 工作区」两个作用域里管理提示词段、技能、MCP 服务器，并把生效配置集实际注入到每个 agent。

- 面板：DSH 侧边栏 `CSMM`（`sidebar.panellist` + `main`）
- 作用域：`global` 与 `workspace:<id>`，工作区同名定义覆盖全局
- 配置集：每作用域一个生效配置集；在「配置集与生效」页勾选资源，开 = 注入，关 = 拦截
- 存储：插件自有 JSON store（全局 + 各工作区），带 revision、原子写、备份、锁
- 生效：按 agent 注册提示词段、注册技能、按组过滤装配结果（contexts 与 `dsh-csmm:*` 始终保留）

## 功能

- **四个标签页**：提示词、技能、MCP、配置集与生效；三张资源页共用四列工作台，选中项跨页保留。
- **资源列表**：提示词、技能、MCP 共用同一套列表壳（搜索行 → 操作行 → 滚动区 → 可选底栏）；顶层分组与 DSH 来源子组都可折叠，搜索时自动展开；折叠状态按列表保存在浏览器本地（同一列表在全局/工作区间保持一致），刷新、切页或切作用域后仍保留；提示词的类型筛选在操作行右侧。
- **配置集管理**：在「配置集与生效」页为每作用域建多个配置集，每层一个生效配置集；顶部下拉可直接切换，也支持继承下层、显式不使用（阻断继承）。编辑器按提示词段 / 工具 / MCP / 技能分栏，支持搜索与只看未包含。勾选只写草稿，点保存才提交；生效配置集的工具勾选就是白名单，一个都不勾选会拒绝所有工具。
- **提示词目录**：插件自有段（`sections/**/*.md`）+ 宿主注册段（`DSH 注册提示词`）+ 运行上下文 + 工具定义统一列在「提示词」页；点击行在中栏看只读全文，行尾显示成员状态（已包含 / 未包含 / 另 N 个配置集），成员写入统一在「配置集与生效」页完成；运行上下文始终注入。
- **自定义提示词**：跟随生效配置集所在作用域，可逐条启用/停用。
- **技能**：作用域感知定义，工作区可覆盖全局；生效组的技能按 agent 注册进宿主（`source/provider: dsh-csmm`）。技能页打开即自动读取 DSH 技能注册表（`ctx.skills`），按来源分组列出全局可见与当前工作区可见的技能（具体 `source`（如 `oh-my-dsh`）优先；通用 `source` 回退 `provider`），显示来源、描述、调用策略与路径；顶部只有一个「刷新」按钮。标签页计数随自动加载更新，不需要先点开技能页。插件技能可编辑 label、描述、正文与调用策略（name 只读），Ctrl+S 保存；DSH 技能在中栏按需加载 SKILL.md 全文（预览/原文，frontmatter 按注册字段重建）。DSH 工作区 project 技能可直接编辑源文件；全局/用户技能只读，可一键复制到当前工作区后再编辑（复制前后校验源 SHA-256，源在复制期间变化则回滚副本）。导入支持 `.md` / `.markdown` 与包含 `SKILL.md` 的目录，读取真实正文；同名同作用域跳过。保存后提示重开会话生效，不自动重载注册表。「配置集与生效」页同步显示同一批 DSH 技能来源组，但只读、不参与勾选。DSH 技能另有作用域策略：按 `source` 记录根优先级（project .dsh > project .agents > custom > user .dsh > user .agents > bundled），工作区策略覆盖全局、缺失继承；非 project、非插件运行时技能可启用/停用，停用后在新会话注册不可调用的同名遮蔽。项目 `.agents` 源只读，项目 `.dsh` 源可编辑；中栏显示根优先级与策略来源。
- **MCP 服务器**：按作用域单独定义，工作区继承全局、同名覆盖；工具开关、连接测试（无探针时如实报错）、密钥与配置分离存储。
- **陌生工作区信任**：未信任工作区进入受限模式，只加载全局配置；信任后才读取该工作区定义。
- **上下文预览**：右侧显示当前生效内容，或正在编辑的配置集草稿（按未保存的成员预览）、诊断、token 预算（200K），以及复制生效内容。

## 作用域与信任

- 身份：技能/MCP 按名称解析，工作区定义优先于全局。
- 生效配置集：`activeGroup[scopeKey]` 缺键 = 继承下层；`''` = 显式不用配置集；有 id = 该配置集生效（含空配置集）。
- 空配置集语义：生效配置集存在即按白名单过滤——开着的段才放行，勾选的工具才放行（工具一个都不勾选就拒绝全部工具）；没有生效配置集时不过滤。
- `disabledPrompts`：按作用域持久化的禁用段清单，与白名单叠加（禁用优先）。
- 信任：全局 store 记录 `workspaces[].trusted`；受限模式下 `chainFor` 只剩全局，可见集/配置集/自定义全部只取全局。

## 数据落盘

```
$DSH_HOME/dsh-csmm/
  store.json        # 全局：配置集/自定义/技能/MCP/信任/activeGroup/disabledPrompts/skillPolicy/revision
  secrets.json      # 全局密钥（0600，只有宿主可读）
  backups/          # 覆盖前备份，保留最近 10 份
  store.lock        # 写锁
  sections/**/*.md  # 插件自有提示词段（name = 相对路径去 .md）

<workspace-root>/.dsh/<workspace-id>/
  store.json / secrets.json / backups / store.lock   # 同上，工作区作用域
  skill-backups/    # DSH 工作区源技能保存前的旧字节（0600，保留最近 20 份）
```

- `workspace-id` 来自 `workspaceRegistry.resolveByPath(root)`，不是目录名。
- 写操作：`expectedRevision` 乐观并发 → 临时文件 → 落盘 → 原子改名；冲突报 `E_REVISION`。
- 快照永不含密钥明文；客户端只见 `envKeys/headerKeys`，写回用 `null` 删、`""` 保留。
- 源技能备份不自动恢复：需要回滚时，先确认没有并发写，把 `skill-backups/` 中对应旧文件复制回原 `SKILL.md`，再重开会话。

## 架构

```
src/shared/   类型 + 作用域解析（resolve.ts：winningLayer/visible*/budget/tokenEstimate）
src/host/     宿主：store ｜ service（snapshot/dispatch/listDshSkills/getDshSkill） ｜ http（RPC） ｜
              materialize（按 agent 注入/过滤） ｜ sections ｜ prompts ｜ paths
src/client/   浏览器侧：hostPort.ts（RemoteHost：load/send/snapshot/dispatch/listPrompts/listDshSkills/getDshSkill/saveDshSkillSource）
src/UI/       面板 MVVM（contracts ｜ model ｜ viewmodel ｜ view）
```

- RPC：`POST /dsh-csmm/rpc`，`{ method: 'snapshot' | 'dispatch' | 'testConnection' | 'promptList' | 'skillCatalog' | 'skillDetail' | 'skillSourceSave' }`。
- `snapshot(scope, workspaceRoot?)` 返回 `{ revision, bootstrap, diagnostics }`。
- `dispatch` 是唯一写通道，共 20 条命令（`src/shared/types.ts` 的 `Command` 联合类型）：
  `group.save/activate/effective/inherit/none/delete`、`custom.save/toggle/delete`、
  `skill.save/toggle/delete/copy/policy`、`mcp.save/toggle/delete/tools`、`prompt.toggle`、`trust.set`。
  `skill.policy` 按 `scope + cwd + name + source` 写入 `on` / `off`，`inherit` 删除本层覆盖。
- 每次 `dispatch` 成功后刷新 materialize；agent 级注册随 agent 释放。
- `promptList(sessionId?, presetId?)`：有 live agent 按 agent 装配，否则按默认 preset 装配，
  返回 sections + contexts + tool schemas（`standard` 下约 144 项）。
- `skillCatalog(scope, workspaceRoot?)`：经宿主 `ctx.skills.list()` 读取当前作用域可见的技能；全局不带 `cwd`，受信任工作区带工作区根；未信任工作区回落全局并带 `restricted: true`。返回 `scannedAt / skills / errors`；每条带 `rootPriority / rootLabel / canDisable / policy / policyFrom / disabled`。被策略停用但当前目录已不可见的条目会合成 `provider: dsh-csmm:policy` 的停用项；不写 store、不导入技能。
- `skillDetail(skillName, scope, workspaceRoot?)`：经宿主 `ctx.skills.get()` 按需读取单个技能，返回 `{ skill, errors, restricted? }`；缺 `skillName` 返回 400。可读的工作区 `.dsh` project 源文件会额外返回 `raw`（磁盘原文）与 `sha256`；读取失败时降级为 `content` 与其 UTF-8 SHA-256，并把原因写进 `errors`。不写 store。
- `skillSourceSave(skillName, scope, text, expectedSha256)`：只接受 `workspace` 作用域。校验当前工作区绑定、技能 origin 为 `workspace`、源文件为工作区内真实的 `SKILL.md`；按 `expectedSha256` 做乐观并发（不匹配返回 409 `E_SKILL_CONFLICT`），保存前把旧字节备份到工作区 `skill-backups/`，再用同目录临时文件 + 原子改名写入。文本限制 800000 UTF-8 字节；不写全局/用户源，也不写项目 `.agents` 源；不改 store/revision。错误码：400（载荷/编码/超限）、403（未信任/只读/越界）、404（技能或源缺失）、409（SHA 冲突）、423（写锁）。
- 面板：提示词页的提示词段 / 工具定义 / 运行上下文行在中栏显示只读全文（读取 `promptList` 结果）；成员状态与写入集中在「配置集与生效」页，提示词页只显示状态与跳转；运行上下文始终注入且不参与配置集，同时计入预算与「生效内容」摘要。

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
npm test             # tsx --test tests/shared + host + client + UI（当前 123 条）
npm run preview:ui   # Vite 预览面板，经代理走真实宿主 RPC
```

- `preview:ui` 把 `/dsh-csmm/rpc` 代理到 `DSH_WEB_ORIGIN`（默认 `http://127.0.0.1:62427`），无 mock 数据；宿主不可达时显示错误与重试。
- 类型检查分三份配置：`tsconfig.host.json` / `tsconfig.ui.json` / `tsconfig.client.json`。
- 注意：`tests/` 下 `mock/model/shared/viewmodel/wiring.test.ts` 是旧夹具，引用已不存在的源码，未纳入 `npm test`；`tsc -p .` 因此仍红，以三份分配置检查为准。

## 验证

- 单测：`npm test`（store 原子写/锁/revision、service snapshot/dispatch/listDshSkills/getDshSkill/saveDshSkillSource、materialize 注入与过滤、resolve 作用域语义、技能注册表投影、技能 Markdown 解析/选择、客户端错误映射、视图模型提交与技能动作、编辑器静态锚点）。
- 构建：`npm run build` 成功且 `node --check dist/index.js dist/client.js` 通过。
- 真机：装到 `web` profile 后重启，新建会话，在会话日志的 system prompt 里核对 `dsh-csmm` 段与开关过滤效果。
- 浏览器回归：见 [docs/BROWSER-TEST-MATRIX.md](docs/BROWSER-TEST-MATRIX.md)、[docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md)、[docs/BROWSER-TEST-SOP.md](docs/BROWSER-TEST-SOP.md)。

## 已知限制

- 提示词开关只过滤 `sections`；工具 schema（约 107 项，含 MCP 工具）由工具注册表单独下发，不受段开关影响。工具白名单通过 `tools.restrict` 按生效配置集执行：勾选的才放行，空名单会拒绝所有工具；改动只对之后新建的 agent（新会话、子代理）生效。
- MCP 服务器只做配置管理（增删改、工具开关、密钥分离），不做宿主启停与真实连接探测；`testConnection` 在无探针时返回明确错误。
- `sections/` 为空且配置集无内容时，面板列表为空是正常状态（无内置演示数据）；`DSH 注册提示词` 列表仍可从宿主读取。
- 插件技能编辑只写插件 store，导入只读所选文件并解析正文，不执行脚本；导入不支持 zip，超过 800000 字节拒绝。保存后不自动重载宿主技能注册表，需重开会话生效；导入的技能不会自动加入生效配置集。
- DSH 技能目录与正文来自宿主 `ctx.skills`（含 bundled / 用户级 / 项目级等注册来源）；目录走 `list()`，点击某条技能时才用 `get()` 加载正文。技能页与配置集页按来源分组显示（具体 `source` 优先，通用 `source` 回退 `provider`）；配置集页只读，因为 DSH 注册表技能由宿主提供，不能通过配置集成员勾选/拦截。全局/用户来源不写回；仅工作区 project 来源的 `.dsh/skills/**/SKILL.md` 可直接保存，项目 `.agents` 源归 Git 管理、插件只读；保存只能写当前工作区内的真实文件（拒绝符号链接/越界路径），每次校验 SHA-256、备份旧字节（最多 20 份）并原子写。未信任工作区只显示全局可见项。策略写入插件 store，不改 DSH 源；停用靠下一次 agent 创建时注册同名不可调用遮蔽，当前会话不承诺即时生效。
- `.dsh/` 已加入 `.gitignore`，工作区 store 不入库。

## 文档地图

| 文件 | 性质 |
|---|---|
| 本 README | 当前实现的权威说明（安装/行为/存储/开发） |
| [AGENTS.md](AGENTS.md) | agent 入口纪律（当前实现、命令与硬规则同步） |
| [SPEC.md](SPEC.md) | 早期双作用域规范草案，仅作设计参考，不再是实现契约 |
| [VSCODE-MAPPING.md](VSCODE-MAPPING.md) | 与 VS Code 配置模型的概念对照，非规范 |
| [docs/BROWSER-TEST-MATRIX.md](docs/BROWSER-TEST-MATRIX.md) | 浏览器测试矩阵（129 例） |
| [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md) | P0 清单 |
| [docs/BROWSER-TEST-SOP.md](docs/BROWSER-TEST-SOP.md) | 浏览器测试 SOP（含环境/夹具/证据规范） |
