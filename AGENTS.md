# AGENTS.md

dsh-csmm 是 DSH 插件：在全局 / 工作区两个作用域里管理提示词段、技能与 MCP，并把生效分组注入到每个 agent。

本文件是 agent 入口，只写：现在是什么、怎么跑、不能做什么、怎么提交。实现细节以 [README.md](README.md) 为准。

## 当前状态

- 已有实现：侧边栏面板、双作用域 store、RPC 后端、按 agent 注入提示词与技能、按组过滤提示词段、DSH 技能注册表自动加载/按来源分组/按需正文、插件技能编辑与 Markdown/目录导入、DSH 全局/用户技能复制到工作区、DSH 工作区源技能 `SKILL.md` 编辑（SHA 校验/备份/原子写）、DSH 技能的作用域策略与根优先级（`skillPolicy`，工作区覆盖全局、缺失继承；停用注册运行时遮蔽）、配置集页的 DSH 技能来源分组、行内启停开关与详情策略操作，以及三张资源页共用的可折叠列表壳。
- [README.md](README.md) 是当前实现的权威说明（安装、存储、RPC、开发、限制）。
- [SPEC.md](SPEC.md) 是早期规范草案，仅作设计参考，不再是实现契约。
- [VSCODE-MAPPING.md](VSCODE-MAPPING.md) 只是概念类比，非规范。
- 浏览器测试资料在 `docs/`。

## 常用命令

```bash
npm install
npm test                 # tsx --test，当前 129 条
npm run build            # 产出 dist/index.js + dist/client.js
npm run preview:ui       # Vite 预览，经代理访问真实宿主 RPC
npx tsc -p tsconfig.host.json --noEmit
npx tsc -p tsconfig.ui.json --noEmit
npx tsc -p tsconfig.client.json --noEmit
```

`tsc -p .` 会因 `tests/` 下的旧夹具报错；类型检查以三份分配置为准。

## 目录

```
src/shared/   类型与作用域解析
src/host/     宿主：store / service / http RPC / materialize / prompts / sections
src/client/   浏览器侧 HostPort 与面板挂载
src/UI/       面板 MVVM（contracts / model / viewmodel / view）
tests/        shared + host + client + UI 单测
docs/         浏览器测试矩阵、清单与 SOP
```

## 硬规则

1. **不手改 profile**：不直接编辑 profile 的 `package.json` / `cordis.patch.yml`；安装用 `dsh plugin add` 或 `plugin_manager install_bundle`。
2. **密钥不进 store / 日志 / 快照**：密钥只写入 `secrets.json`（0600），快照只暴露 `envKeys` / `headerKeys`。
3. **作用域只有两个**：`global` 与 `workspace:<id>`；不引入会话层。工作区同名定义覆盖全局。
4. **空组即白名单**：存在生效组时，只有组内选中的提示词段与工具放行；工具名单为空即拒绝全部工具；但 `contexts` 与 `dsh-csmm:*` 始终保留。
5. **写路径受限**：只写 `$DSH_HOME/dsh-csmm/` 与 `<workspace>/.dsh/<workspace-id>/`；`.dsh/` 不入库。唯一受控例外：`skillSourceSave` 可改写当前工作区 project 来源的 `.dsh/skills/**/SKILL.md`（必须位于该工作区内、非符号链接）；写入前按 SHA-256 校验并在 `<workspace>/.dsh/<workspace-id>/skill-backups/` 留旧字节（0600，最多 20 份），原子写。项目 `.agents` 技能归 Git 管理，插件只读；不得写全局/用户技能源。`skillPolicy` 只写插件 store，不改 DSH 源。
6. **契约同步**：改 RPC 或 `Command` 时，同时更新 `src/shared/types.ts`、host、client 与 UI，避免两侧漂移。
7. **不要复活 mock**：面板数据只来自宿主 RPC；宿主不可达时显示错误与重试。
8. **声称完成前必须实跑**：`npm test`、三份 `tsc`、`npm run build`；只报实际命令与结果。
9. **不主动做兼容**：没有明确要求兼容旧版本 / 旧数据时，禁止添加迁移、回退、双读双写、特性探测等兼容代码；旧字段直接删，旧语义直接用新规则替换，旧数据由用户自行处理。确需兼容时先问清范围与期限。

## 提交规范

使用 Conventional Commits，**冒号后面的摘要用中文**：

```
<type>(<scope>): <中文摘要>
```

- `type` 用英文：`feat` / `fix` / `docs` / `refactor` / `test` / `build` / `chore`。
- `scope` 可选，用英文：`ui` / `host` / `client` / `shared`。
- 冒号后必须中文，简洁说明做了什么；不以句号结尾。
- 一次提交只做一件事；需要时在正文写动机与验证命令。

示例：

```
feat(ui): 支持提示词段开关
fix(host): 修复工作区信任读取
docs: 重写 README
refactor(host): 拆分提示词注入模块
```

## 文档指针

| 需要什么                  | 去哪里                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装、存储布局、RPC、限制 | [README.md](README.md)                                                                                                                                           |
| 技能与提示词语义          | [docs/SKILL-PROMPT-SEMANTICS.md](docs/SKILL-PROMPT-SEMANTICS.md)                                                                                                  |
| 早期设计草案（参考）      | [SPEC.md](SPEC.md)                                                                                                                                               |
| VS Code 配置类比          | [VSCODE-MAPPING.md](VSCODE-MAPPING.md)                                                                                                                           |
| 浏览器回归测试            | [docs/BROWSER-TEST-MATRIX.md](docs/BROWSER-TEST-MATRIX.md)、[docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md)、[docs/BROWSER-TEST-SOP.md](docs/BROWSER-TEST-SOP.md) |
