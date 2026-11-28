# dsh-csmm 浏览器功能测试矩阵（t2）

> 本文件是 `t2` 的交付物：把 dsh-csmm **当前实现**（不是 README 里的旧 SPEC 引入包）拆成可执行的浏览器测试清单与可观察断言。只写清单，不写测试代码，不修改 `src/`。
>
> 依据：`src/**`（提交 `e4d961d` 拆分视图模型及之前全部提交）、`.omd/specs/deep-interview-dsh-csmm-backend.md`、`.omd/prd/dsh-csmm-backend.json`。仓库根的 `README.md`/`AGENTS.md` 描述的是旧 SPEC 包，与当前插件实现不一致，不作为本矩阵依据。

## 0. 测试环境与入口

| 项 | 值 |
|---|---|
| 宿主 | `dsh --profile web`（端口/鉴权 URL 以 t1 环境侦察为准） |
| 插件 | 本仓 `E:\Code\_dev_skill_mcp\dsh-csmm`，经 `plugin_manager install_bundle` 装入 profile |
| 面板 | 左侧边栏 `CSMM` 入口 → 主区 `dsh-csmm` 面板 |
| RPC | 同源 `POST <GUI_ORIGIN>/dsh-csmm/rpc`，方法 `snapshot` / `dispatch` / `testConnection` |
| 全局数据 | `$DSH_HOME/dsh-csmm/{store.json,secrets.json,backups/,store.lock}`（Windows 一般为 `%USERPROFILE%\.dsh`） |
| 工作区数据 | `<WSROOT>/.dsh/<WS_ID>/store.json` |
| 测试工作区 | 建议用临时目录（如 `%TEMP%\csmm-ws`）由 `dsh web` 打开，避免把 `.dsh/` 写进本仓；`<WSROOT>` 即该目录，`<WS_ID>` 从 UI 作用域栏读取 |

**测试前必须备份** `$DSH_HOME/dsh-csmm/` 与 `<WSROOT>/.dsh/`，测试后恢复；不要在真实用户配置上执行删除类用例。

RPC 断言统一用（只读，便于取证）：

```bash
curl -s -X POST "$GUI_ORIGIN/dsh-csmm/rpc" \
  -H 'content-type: application/json' \
  -d '{"method":"snapshot","workspaceRoot":"<WSROOT>"}'
```

`dispatch` 断言示例：

```bash
curl -s -X POST "$GUI_ORIGIN/dsh-csmm/rpc" -H 'content-type: application/json' \
  -d '{"method":"dispatch","workspaceRoot":"<WSROOT>","command":{"type":"group.save","scope":{"kind":"global","id":null},"expectedRevision":10,"group":{...},"name":"x"}}'
```

## 1. 断言记号与数据夹具

### 1.1 记号

| 记号 | 含义 |
|---|---|
| `[DOM]` | 浏览器内可见文本/属性/角色，可用 `dsh_browser_a11y`、`dsh_browser_find`、`dsh_browser_assert` 取证 |
| `[TOAST]` | `#toastHost` 内 `.toast` 文本（`role=status`，`aria-live=polite`） |
| `[RPC]` | `snapshot` / `dispatch` 返回 JSON 字段（见每行括号） |
| `[DISK]` | `store.json` / `secrets.json` / `backups/` 文件内容或存在性 |
| `[REV]` | `snapshot.revision` 的变化；记 `R0` = 操作前读到的值，禁止硬编码 |
| `[STORE]` | 全局或工作区 store 的 `revision` 单独变化（工作区写会同时改两个文件） |

### 1.2 环境变量与读取顺序

1. 装好插件并首次打开 CSMM 面板后，先读 `[RPC] revision`（空 store 为 `0`）和工作区栏：`button[data-scope=workspace][data-id]` 的 `data-id` 即 `<WS_ID>`（由 `workspaceRegistry.resolveByPath` 提供，不是虚构 id）。
2. **先**用 `<WS_ID>` 写好两份 fixture，再刷新页面；否则服务的 `workspace` 绑定可能是空的，`snapshot` 不加载工作区。

### 1.3 Fixture G（全局 `$DSH_HOME/dsh-csmm/store.json`，基线期望见 §1.5）

```json
{
  "schemaVersion": 1,
  "revision": 10,
  "workspaces": [{ "id": "<WS_ID>", "trusted": true }],
  "activeGroup": { "global:": "g-base" },
  "groups": [
    { "id": "g-base", "name": "基础组", "scope": { "kind": "global", "id": null }, "enabled": true,
      "items": [{ "kind": "skill", "name": "alpha" }, { "kind": "mcp", "name": "alpha-mcp" }] },
    { "id": "g-empty", "name": "空组", "scope": { "kind": "global", "id": null }, "enabled": true, "items": [] },
    { "id": "g-missing", "name": "缺引用组", "scope": { "kind": "global", "id": null }, "enabled": true,
      "items": [{ "kind": "section", "name": "ghost-section" }, { "kind": "skill", "name": "ghost-skill" }, { "kind": "mcp", "name": "ghost-mcp" }] },
    { "id": "g-off", "name": "停用组", "scope": { "kind": "global", "id": null }, "enabled": true,
      "items": [{ "kind": "skill", "name": "off-skill" }, { "kind": "mcp", "name": "off-mcp" }] }
  ],
  "customs": [
    { "id": "c-style", "title": "回答风格", "scope": { "kind": "global", "id": null }, "text": "用中文回答", "enabled": true },
    { "id": "c-off", "title": "禁用示例", "scope": { "kind": "global", "id": null }, "text": "不要使用", "enabled": false }
  ],
  "skills": [
    { "name": "alpha", "label": "Alpha", "scope": "global", "bytes": 5120, "model": true, "user": true, "desc": "示例技能", "text": "技能正文甲", "enabled": true },
    { "name": "beta", "label": "Beta", "scope": "global", "bytes": 2048, "model": true, "user": false, "desc": "第二个技能", "text": "技能正文乙", "enabled": true },
    { "name": "off-skill", "label": "Off Skill", "scope": "global", "bytes": 1024, "model": true, "user": true, "desc": "已停用技能", "text": "停用技能正文", "enabled": false },
    { "name": "plug-skill", "label": "Plug Skill", "scope": "global", "bytes": 1024, "model": true, "user": true, "desc": "插件技能", "text": "插件技能正文", "enabled": true, "bundled": true }
  ],
  "servers": [
    { "name": "alpha-mcp", "label": "Alpha MCP", "scope": "global", "status": "connected", "transport": "stdio",
      "tokens": 120, "auth": "none", "enabled": true, "tools": [{ "name": "search", "on": true }, { "name": "write", "on": false }],
      "instructions": "示例服务器说明", "command": "node", "args": ["server.js"], "envKeys": [] },
    { "name": "off-mcp", "label": "Off MCP", "scope": "global", "status": "disconnected", "transport": "http",
      "tokens": 30, "auth": "none", "enabled": false, "tools": [{ "name": "ping", "on": true }],
      "instructions": "", "url": "http://127.0.0.1:9/mcp", "headerKeys": [] }
  ]
}
```

### 1.4 Fixture W（工作区 `<WSROOT>/.dsh/<WS_ID>/store.json`）

```json
{
  "schemaVersion": 1,
  "revision": 4,
  "workspaces": [],
  "activeGroup": {},
  "groups": [
    { "id": "g-ws", "name": "工作区组", "scope": { "kind": "workspace", "id": "<WS_ID>" }, "enabled": true,
      "items": [{ "kind": "skill", "name": "alpha" }] }
  ],
  "customs": [
    { "id": "c-ws", "title": "工作区补充", "scope": { "kind": "workspace", "id": "<WS_ID>" }, "text": "只在工作区生效", "enabled": true }
  ],
  "skills": [
    { "name": "alpha", "label": "Alpha（工作区覆盖）", "scope": "workspace", "wsId": "<WS_ID>", "bytes": 6144, "model": true, "user": true, "desc": "工作区同名覆盖", "text": "工作区覆盖正文", "enabled": true },
    { "name": "gamma", "label": "Gamma", "scope": "workspace", "wsId": "<WS_ID>", "bytes": 1024, "model": true, "user": false, "desc": "仅工作区", "text": "伽马", "enabled": true }
  ],
  "servers": [
    { "name": "alpha-mcp", "label": "Alpha MCP（工作区）", "scope": "workspace", "wsId": "<WS_ID>", "status": "connected",
      "transport": "stdio", "tokens": 7, "auth": "none", "enabled": true,
      "tools": [{ "name": "search", "on": true }], "instructions": "工作区覆盖说明", "command": "node", "args": ["ws.js"], "envKeys": [] }
  ]
}
```

### 1.5 基线期望（用于把断言写成确定值）

| 视图 | 期望 |
|---|---|
| 全局页签计数 | 提示词 `6`（4 组 + 2 自定义），技能 `4`，MCP `2` |
| 全局预览 | 生效组 `基础组`，`≈ 125 tok`，预算 `130 / 200K tok`（技能 5 + MCP 120 + 自定义 5），诊断 `3`（无提示词段 info、工具 deny warn、技能遮蔽 info），`工具 deny 1`、`技能遮蔽 3` |
| 全局分组行 | `基础组`：`2 项 · 0 段 / 1 MCP / 1 技能`；`空组` tag `空` |
| 技能列表（全局） | `Alpha / alpha`、`Beta / beta`、`Off Skill / off-skill`（dot off）、`Plug Skill / plug-skill` + tag `插件` |
| 工作区 A（已信任，无生效分组） | 页签 `2 / 5 / 2`；预览沿用 `基础组`（来自全局）并出现继承说明；`≈ 14 tok`，预算 `19 tok`，诊断 `3`（无提示词段 + deny 1 + 遮蔽 4） |
| 工作区 A（`g-ws` 生效） | 预算 `14 tok`（alpha 7 + c-ws 7），`被本层覆盖的下层分组 · 1`，诊断 `2`（无提示词段 + 遮蔽 4） |
| 工作区 A（未信任） | 提示词 `0`，技能 `4`，MCP `2`；受限横幅；`[RPC] diagnostics` 含 `W_TRUST` |
| 工作区 A 同名覆盖 | 技能仅 1 行 `Alpha（工作区覆盖）`，`6 KB`；MCP 仅 1 行 `Alpha MCP（工作区）`，`≈ 7 tok` |

## 2. 覆盖映射（任务要求 → 行 ID）

| 要求 | 覆盖行 |
|---|---|
| 作用域链、全局/工作区覆盖、同名覆盖、空分组、显式 none、继承 | SCOPE-01/03/05/06、GRP-01/07/08/09/10/11/12、SKL-06、MCP-06 |
| 工作区信任弹窗、暂不信任受限、重新信任 | TRUST-01～TRUST-09 |
| 分组 CRUD、设为生效、草稿保存/还原、白名单与成员勾选 | GRP-02～GRP-06、GRP-15～GRP-23 |
| 技能 CRUD、复制/迁移、SKILL.md 预览/原文、启停、只读扫描 DSH 技能目录 | SKL-01～SKL-21、SKL-23 |
| MCP CRUD、添加/编辑弹窗字段、工具开关、测试连接（诚实错误）、原文只读 | MCP-01～MCP-22 |
| 自定义提示词 CRUD 与逐条启停 | CUS-01～CUS-06 |
| token 预算（context/section/skill/mcp/custom）、诊断项、复制生效内容 | SUM-01～SUM-12 |
| secrets 不落 store/不返回 snapshot、revision/并发冲突、持久化与重启 | DAT-01～DAT-11 |
| 面板注册、侧边栏入口、空/加载/错误态、响应式与基本 a11y | ENV-01～ENV-09、UX-01～UX-07 |

## 3. 功能矩阵

### 3.1 面板注册、RPC 与环境（ENV）

| ID | 功能/场景 | 前置数据 | 操作步骤 | 可观察断言 | P | 已知限制 |
|---|---|---|---|---|---|---|
| ENV-01 | 面板入口 | 插件已装、宿主已起 | 打开 GUI，看左侧边栏 | `[DOM]` 侧栏列出 `CSMM`（注册项 `sidebar.panellist`，id `dsh-csmm`） | P0 | 无 |
| ENV-02 | 主面板加载 | 同上 | 点侧栏 `CSMM` | `[DOM]` 面板标题区出现 `系统提示词`；四列 `nav[aria-label=作用域]`、`nav[aria-label=列表]`、`main[aria-label=编辑]`、`aside[aria-label=生效预览]` 均存在 | P0 | 无 |
| ENV-03 | RPC 只读快照 | 面板已加载 | 执行 §0 的 snapshot curl | `[RPC]` HTTP 200，`ok:true`；`snapshot.revision` 为数字；`bootstrap` 含 `workspaces/sections/skills/servers/groups/customs/activeGroup/copy`；`diagnostics` 为数组 | P0 | `sections` 当前恒为 `[]`（见 LIM-01） |
| ENV-04 | 缺 command / 未知方法 | 无 | curl `dispatch` 不带 command；再带 `method:"nope"` | `[RPC]` 400 `E_PAYLOAD` `command is required`；400 `E_KIND` `unknown method: nope` | P1 | 无 |
| ENV-05 | 非 POST / 坏 JSON / 超大 body | 无 | curl PUT；POST 非 JSON；POST 1.1MB body | `[RPC]` 405 `E_PROFILE` `method not allowed`；400 `E_PARSE`；400 `E_PARSE` `request body too large` | P1 | 超大 body 用例需脚本生成，浏览器内不测 |
| ENV-06 | 后端未连接错误态 | host 未加载或路由 404（可用 `dsh web` 关闭插件后重载页面模拟） | 打开面板 | `[DOM]` 出现 `CSMM 后端未连接：…`、提示 `确认插件 host 已加载，且当前页面与 /dsh-csmm/rpc 同源。`、按钮 `重试`；点 `重试` 后仍失败则保持错误块 | P1 | 正常安装路径不会触发；需临时禁用 host 才可测，恢复后必须重启宿主 |
| ENV-07 | 加载态 | 刷新页面 | 立即观察主区 | `[DOM]` 出现 `正在加载 CSMM 配置…`，随后被 App 替换 | P2 | 本机加载过快，通常只能靠慢网络/断点看到；不纳入自动断言 |
| ENV-08 | revision 基线 | Fixture G | snapshot | `[RPC] revision = 10`；非 10 但能解释（此前写入/残留）→ 记录 `R0` 并以此推算，允许继续；不可解释 → 停并重播种 | P0 | 真实用户 store 可能非 10，以实际值为 `R0`，禁止硬编码 |
| ENV-09 | 页签计数与作用域栏徽标 | Fixture G + W，全局 | 看 `#pageTabs` 与全局按钮 | `[DOM]` prompt/skill/mcp 页签 `span.n` 依次 `6 / 4 / 2`；全局按钮徽标 `6`；工作区按钮徽标 `2` | P0 | 徽标按“本作用域组+自定义”计数，与信任无关 |

### 3.2 作用域链与工作区信任（SCOPE / TRUST）

| ID | 功能/场景 | 前置数据 | 操作步骤 | 可观察断言 | P | 已知限制 |
|---|---|---|---|---|---|---|
| SCOPE-01 | 默认全局作用域 | Fixture G | 刷新页面 | `[DOM]` 全局按钮 `aria-current`；面包屑 `全局`；TopBar hint 为 copy.scopeHint 文案；无信任弹窗 | P0 | 初始 scope 恒为 global，刷新不会自动进入工作区 |
| SCOPE-02 | 工作区行信息 | 宿主注册了工作区 | 看作用域栏 | `[DOM]` `div.rail-sec` 文本 `工作区 N`；工作区按钮 `data-id=<WS_ID>`、`title=<path>`、显示 title 与路径；当前工作区带 tag `当前` | P0 | 工作区标题/路径来自 workspaceRegistry，不是 fixture |
| SCOPE-03 | 切到已信任工作区 | Fixture G trusted=true | 点工作区按钮 | `[DOM]` 面包屑 `工作区 · <title>`；页签 `2 / 5 / 2`；技能列表出现 `Alpha（工作区覆盖）`、`Gamma` | P0 | 无 |
| TRUST-01 | 首开未信任弹窗 | 改 G：`workspaces[0].trusted=false`，`revision=20`，工作区 store 保留 | 刷新后点工作区 | `[DOM]` 弹窗 `#modalTitle` = `信任此工作区？`；正文含 `首次打开这个工作区…`；显示工作区 title 与路径；按钮 `暂不信任`、`信任并加载` | P0 | 弹窗只在 UI 首次 setScope 时出现；刷新页面后 scope 回到全局，不会自动弹 |
| TRUST-02 | 暂不信任进入受限 | TRUST-01 后 | 点 `暂不信任` | `[DOM]` 弹窗关闭；`[TOAST]` `已保持受限访问（可随时在左栏重新信任）`；`[DOM]` 列表头出现 `div.note.trust-banner[data-restricted]`，文本含 `受限模式` 与 `信任后才会读取…`；页签计数 `0 / 4 / 2`；作用域行 tag `未信任` | P0 | `trustDeclined` 仅 UI 内存，刷新即失效（LIM-04） |
| TRUST-03 | 拒绝后写入被服务端拒绝 | TRUST-02 状态 | 点 `+ 新分组`，再点 `保存草稿` | `[TOAST]` `保存失败：workspace is not trusted`；`[RPC] revision` 不变；`[DISK]` 工作区 store 未创建/未修改 | P0 | 服务端 `E_TRUST` 是权威防线；UI 仍允许本地编辑 |
| TRUST-04 | 横幅重新信任 | TRUST-02 状态 | 点 `信任并加载` | `[TOAST]` `已信任工作区 <title>`；横幅消失；页签 `2 / 5 / 2`；`[RPC]` 全局 store `workspaces[].trusted=true`、`revision=R0+1`；`[DISK]` 全局 store 已写 | P0 | 无 |
| TRUST-05 | 弹窗接受信任 | TRUST-01 状态 | 点 `信任并加载` | 同 TRUST-04；`[DOM]` 不再出现弹窗 | P0 | 无 |
| TRUST-06 | 信任后工作区数据可见且隔离 | TRUST-05 后 | 切全局再切回工作区 | `[DOM]` 全局页签 `6 / 4 / 2`，工作区 `2 / 5 / 2`；全局技能列表不含 `Gamma`；工作区页签技能 `5` | P0 | 全局页不展示工作区技能，是设计（LIM-03） |
| TRUST-07 | 信任持久化 | TRUST-05 后 | 刷新页面，再进工作区 | `[DOM]` 无弹窗直接加载；`[RPC]` `trusted:true` | P1 | 需要宿主未重启也可；重启见 DAT-06 |
| TRUST-08 | 信任弹窗 a11y | TRUST-01 状态 | 观察焦点；按 `Escape` | `[DOM]` `div.modal[role=dialog][aria-modal=true][aria-labelledby=modalTitle]`；打开后焦点落在弹窗首个按钮；`Escape` 关闭并把焦点还给触发按钮 | P1 | Tab 首尾环绕只在弹窗内成立 |
| TRUST-09 | 不信任时快照诊断 | TRUST-02 状态 | snapshot curl | `[RPC]` `diagnostics` 含 `{code:"W_TRUST", severity:"warning", message:"workspace is restricted until trusted"}`；`skills` 只剩全局 4 个 | P0 | 该 W_TRUST 只出现在“请求 scope 是未信任工作区”的快照里 |
| SCOPE-04 | 工作区 store 缺失 | 删除 `<WSROOT>/.dsh/<WS_ID>/`（保留全局 trusted） | 刷新并进工作区 | `[DOM]` 无报错；页签 `0 / 4 / 2`（无本地组/自定义）；预览继承全局；`[DISK]` 不写文件直到首次工作区写 | P1 | 只有写操作才创建 `.dsh/<id>/store.json` |
| SCOPE-05 | 空 store 冷启动 | `store.json` 不存在 | 刷新 | `[RPC] revision=0`；`[DOM]` 列表空态 `该作用域还没有分组`、`没有匹配的技能`、`没有匹配的服务器`；预览 `当前作用域链上还没有生效分组。左侧启用一个分组，或在编辑器里添加资源。`；编辑器 `左侧选择分组或自定义。` | P1 | 空 store 时 `sections` 仍 `[]` |
| SCOPE-06 | 全局不显示继承入口 | Fixture G | 全局列表 | `[DOM]` 全局页只有 `+ 新分组`、`+ 新自定义`、`不使用分组`；没有 `继承下层` 行 | P1 | 继承入口仅工作区出现（设计） |
| SCOPE-07 | schemaVersion 拒绝 | 改 G `schemaVersion:2` | 刷新 | `[DOM]` 面板错误块 `CSMM 后端未连接：…unsupported schemaVersion`；`[RPC]` 500 `E_SCHEMA` | P1 | 恢复 fixture 后重试 |

### 3.3 分组、草稿与覆盖（GRP）

| ID | 功能/场景 | 前置数据 | 操作步骤 | 可观察断言 | P | 已知限制 |
|---|---|---|---|---|---|---|
| GRP-01 | 默认生效分组预览 | Fixture G | 看右栏 `生效内容` | `[DOM]` 链节点 `全局` 高亮；`✓ 基础组`；`≈ 125 tok`；`提示词段 0` + `没有选入提示词段。`；`技能 1`；`MCP 服务器 1`；自定义 `自定义 · 回答风格`；`生效合计 130 tok`；`工具 deny 1`；`技能遮蔽 3` | P0 | `提示词段 0` 是生产现实（LIM-01） |
| GRP-02 | 新建分组（本地草稿） | 全局 | 点 `+ 新分组` | `[DOM]` 列表新增 `分组 N`，选中并进入编辑器；`[TOAST]` `已创建分组（尚未生效，可编辑后设为生效）`；行内状态 `编辑中`；`[REV]` 不变，`[DISK]` 不变 | P0 | 新建只改本地 state，不落库 |
| GRP-03 | 保存草稿 | 选中 `基础组` | 改名 `基础组改`，点 `保存草稿` | `[DOM]` `#saveBtn` 变 disabled；`[TOAST]` `分组已保存`；`[REV] R0+1`；`[DISK]` `groups.find(id=g-base).name` 变更；页签 prompt 计数不变 | P0 | 无 |
| GRP-04 | 还原草稿 | 选中 `基础组` | 改名后点 `还原` | `[DOM]` 名称恢复；`未保存更改` 消失；`保存草稿` disabled；`[REV]` 不变 | P1 | 无 |
| GRP-05 | 设为生效（无未保存改动） | 选中 `空组` | 点 `设为生效` | `[DOM]` 状态 chip `生效中`；`[TOAST]` `已保存并设为生效：空组` + `撤销`；`[RPC] activeGroup["global:"]="g-empty"`；`[REV] R0+1`；预览切到 `✓ 空组` 且诊断出现 `生效分组是空组` | P0 | 空组会写入 `activeGroup`，不会写入 items |
| GRP-06 | 保存并设为生效（脏草稿） | 选中 `基础组` 且其非生效组（先让 `空组` 生效，否则无 `[data-effective]`）；勾掉 `alpha-mcp`（不保存） | 点 `保存并设为生效` | `[DOM]` 预览立即只显示 `alpha`（本次会话内）；`[TOAST]` 同上；`[REV] R0+1`；**`[DISK]` `g-base.items` 仍是旧值（含 alpha-mcp）**；刷新后勾选丢失 | P0 | **已知缺陷**：`setEffectiveGroup` 只发 `group.effective`，不发 `group.save`（LIM-05）；按钮不渲染时先按 GRP-05 解锁，记 BLOCKED 而非 FAIL |
| GRP-07 | 继承下层（工作区） | 工作区 A，`activeGroup` 无键 | 点 `继承下层` | `[DOM]` `[TOAST]` `已恢复继承（沿用下层分组）`；预览出现 `当前作用域没有自己的生效分组，沿用 全局 的「基础组」。`；`[RPC]` 工作区 `activeGroup` 无该键；`[DISK]` 工作区 store 已写、全局 revision 也 +1 | P0 | 工作区写会双写两个文件（LIM-06） |
| GRP-08 | 显式不使用分组（阻断继承） | 工作区 A，当前继承全局 | 点 `不使用分组` | `[TOAST]` `本层已声明不使用分组（阻断继承）`；`[RPC] activeGroup["workspace:<WS_ID>"]=""`；预览 `当前作用域链上还没有生效分组…`；预算 0（显式 none 时上层自定义也不进入） | P0 | UI 的 `winningLayer` 把 `""` 当显式空；服务端同语义 |
| GRP-09 | 从空恢复继承 | GRP-08 状态 | 点 `继承下层` | `[TOAST]` 恢复继承；`[RPC]` 键被删除；预览重新显示全局 `基础组` | P1 | 无 |
| GRP-10 | 全局“不使用分组” | 全局 | 点 `不使用分组` | `[TOAST]` `本层已声明不使用分组（阻断继承）`；`[RPC] activeGroup["global:"]=""`；预览空态；再点 `继承下层` 恢复 | P1 | 全局没有可继承层，继承操作只是删除键 |
| GRP-11 | 下层分组被覆盖提示 | 工作区 A 设 `g-ws` 生效 | 选 `g-ws`，点 `设为生效` | `[DOM]` 预览 `被本层覆盖的下层分组 · 1`，行 `全局` / `基础组 · 2 项被覆盖`；链节点 `工作区` 高亮；预算 `14 tok` | P0 | 只有“本层有生效组且下层也有组”才显示 |
| GRP-12 | 同名资源覆盖（技能） | 工作区 A | 切工作区，看技能列表与预算 | `[DOM]` 只有一行 `Alpha（工作区覆盖） / alpha`，`6 KB`；预览技能 `alpha` 的 meta 为工作区文案；预算技能按 7 tok 计 | P0 | 覆盖是整条记录覆盖，不做字段合并 |
| GRP-13 | 同名资源覆盖（MCP） | 工作区 A | 切工作区，选 `alpha-mcp` | `[DOM]` 列表只有 1 行 `Alpha MCP（工作区）`；McpPane 标签含 `工作区定义`/`本层覆盖`；`[RPC]` 快照 `servers` 同名仅 1 条；预算 7 tok | P0 | 无 |
| GRP-14 | 空组编辑态 | 选中 `空组` | 观察编辑器 | `[DOM]` 状态 chip `本层为空`；`#sumSection/#sumMcp/#sumSkill` 均 0；无 `data-empty-prompt`（只有技能/MCP 时才提示）；保存不产生 item 变化 | P1 | 空组无“空组提示”，提示在生效后由诊断给出 |
| GRP-15 | 白名单勾选与保存 | 选中 `基础组` | 勾选 `Beta` 技能；点 `保存草稿` | `[DOM]` `#sumSkill` 增加；`[TOAST]` `分组已保存`；`[DISK]` `g-base.items` 含 beta；预览若生效则多一行技能 | P0 | 勾选先落在 draft，保存才发 RPC |
| GRP-16 | 未列入资源一键加入 | 选中 `基础组` | 展开 `未列入的资源`，点 `+ Gamma`（工作区） | `[DOM]` 该 chip 消失、技能区出现 `Gamma` 勾选；`保存草稿` 变可用；保存后 `[DISK]` items 含 gamma | P1 | 加入动作本身不发 RPC |
| GRP-17 | 组内搜索与过滤 | 选中 `基础组` | 搜索 `alp`；再点 `已选` | `[DOM]` 仅显示匹配项；`已选` 只显示勾选；`未选` 只显示未勾选；无匹配时空文本 | P2 | 过滤只影响显示，不影响保存内容 |
| GRP-18 | 提示词段白名单（生产为空） | 生产宿主 | 展开 `提示词段` details | `[DOM]` 显示 `没有匹配的提示词段。`；`全选/清空` 无实际项可操作；`[RPC] snapshot.bootstrap.sections = []` | P1 | **无法端到端测试**：宿主恒传 `sections: []`（LIM-01）；需夹具替身才能覆盖 |
| GRP-19 | 删除分组两步 | 选中 `空组` | 点 `删除分组` → 点 `取消` → 再点 `删除分组` → 点 `确认删除` | `[DOM]` 第一击出现 `确认删除`/`取消`（**无定时器**）；`取消` 回到初始且分组仍在；确认后行消失、编辑器空；`[TOAST]` `已删除分组` + `撤销`；`[DISK]` 分组消失；若删的是生效组，`[RPC] activeGroup` 键被删 | P0 | 删除生效组后预览回到无组/继承 |
| GRP-20 | 撤销删除（本地） | GRP-19 后 | 点 toast `撤销` | `[DOM]` 列表行恢复、选中恢复；**`[DISK]` 仍是已删除**；刷新后行再次消失 | P1 | **已知缺陷**：撤销闭包只改本地 state，不发 `group.save`（LIM-07） |
| GRP-21 | 名称清空保存回退 | 选中 `基础组` | 清空 `#itemName`，保存 | `[DISK]` 名称变 `未命名分组`；`[DOM]` 输入框显示该名；`[REV] +1` | P2 | 无 |
| GRP-22 | Ctrl+S 保存草稿 | 选中 `基础组`，改名 | 按 `Ctrl+S` | `[TOAST]` `分组已保存`；`[DISK]` 名称更新；弹窗打开时 Ctrl+S 不生效 | P2 | 无 |
| GRP-23 | 加入分组（资源面板） | 工作区 A 有生效组 `g-ws`，选中技能 `Gamma` | 点详情 `加入分组` | `[TOAST]` `已加入当前分组`；编辑器技能区出现 Gamma；`[REV]` 不变（若不经过保存草稿） | P2 | **已知缺陷**：`setGroupItem/addSkillsToGroup` 直接改本地 items，不发 RPC（LIM-08） |

### 3.4 自定义提示词（CUS）

| ID | 功能/场景 | 前置数据 | 操作步骤 | 可观察断言 | P | 已知限制 |
|---|---|---|---|---|---|---|
| CUS-01 | 新建并自动选中 | 全局 | 点 `+ 新自定义` | `[DOM]` 列表出现 `自定义 N` 并选中；编辑器标题 `自定义 N`；`#saveState` `未保存`；`[REV]` 不变 | P0 | 新建不落库 |
| CUS-02 | 保存自定义 | CUS-01 后 | 输入正文 `补充说明`，点 `保存` | `[TOAST]` `已保存`；`#saveState` `已保存`；`#charCount` 显示字数与 token；`[REV] +1`；`[DISK]` customs 新增且 `scope.kind=global`；预览自定义数 +1，预算增加 | P0 | 自定义只影响当前作用域 |
| CUS-03 | 还原自定义 | 选中 `回答风格` | 改正文后点 `还原` | `[DOM]` 正文恢复；`未保存` 消失；`[REV]` 不变 | P1 | 无 |
| CUS-04 | 逐条停用/启用 | 选中 `回答风格` | 点行首复选框 | `[DOM]` 复选框 `aria-label` 在 `停用/启用自定义提示词 回答风格` 间切换；行出现 `已停用`；预览该条消失、预算减少 5；`[REV] +1`；`[DISK] enabled=false` | P0 | 停用后仍保留定义，不删除 |
| CUS-05 | 停用项不进入预算 | Fixture `c-off` | 看预览与预算 | `[DOM]` `自定义提示词 1`（只有 c-style）；`c-off` 不出现在预览；预算不含其 4 tok | P1 | 无 |
| CUS-06 | 删除自定义两步 + 撤销 | 选中 `禁用示例` | 删除 → 确认 → 点 `撤销` | `[DOM]` 行消失再恢复；`[TOAST]` `已删除自定义`；`[DISK]` 删除后刷新不恢复 | P1 | 撤销不落库（同 LIM-07） |

### 3.5 技能（SKL）

| ID | 功能/场景 | 前置数据 | 操作步骤 | 可观察断言 | P | 已知限制 |
|---|---|---|---|---|---|---|
| SKL-01 | 技能列表与标记 | Fixture G，全局 | 看技能页 | `[DOM]` 4 行：`Alpha / alpha`、`Beta / beta`、`Off Skill / off-skill`（dot off、`已停用`）、`Plug Skill / plug-skill` + tag `插件`；每行有 scope tag `全局` | P0 | 无 |
| SKL-02 | 搜索过滤 | 全局技能页 | `#skillSearch` 输入 `bet`；再输 `zzz` | `[DOM]` 仅 `Beta`；无匹配显示 `没有匹配的技能`；清空恢复 | P1 | 搜索匹配 name+label+desc（小写包含） |
| SKL-03 | 插件技能开关显示 | 全局技能页 | 取消勾选 `显示插件自带技能` | `[DOM]` `Plug Skill` 消失；再勾选恢复 | P2 | 仅 UI 过滤，不落库 |
| SKL-04 | 选择技能打开面板 | 全局技能页 | 点 `Alpha` 行 | `[DOM]` 编辑器标题 `Alpha`；tag `全局定义`；meta 含位置 `~/.dsh/skills/alpha/SKILL.md`、`5 KB`、`启用`、调用策略；footer 说明文案 | P0 | 无 |
| SKL-05 | 全局启停 | 选中 `Beta` | 点 `停用` | `[TOAST]` `已停用 beta（全局）`；行 dot off；`[REV] +1`；`[DISK]` beta `enabled=false`；预览/预算不含它（若在组内） | P0 | 停用按钮对 bundled 技能禁用 |
| SKL-06 | bundled 技能不可启停 | 选中 `Plug Skill` | 观察 `[data-sktoggle]` | `[DOM]` 按钮 `disabled`；点击无 toast、无 RPC | P1 | 删除是否允许另测（SKL-16） |
| SKL-07 | 工作区 copy-on-write 启停 | 切工作区 A，选中全局技能 `Beta` | 点 `停用` | `[TOAST]` `已停用 beta（当前工作区）`；`[DISK]` 工作区 store 新增 beta 覆盖且 `enabled=false`；全局 store `beta` 不变；全局 revision +1；面板 tag `本层覆盖`/`已停用` | P0 | 服务端 `skill.save` 走 upsert，不修改全局记录 |
| SKL-08 | 工作区再次启用 | SKL-07 后 | 点 `启用` | `[DISK]` 工作区覆盖 `enabled=true`；dot on；全局不变 | P1 | 覆盖记录保留，不会删除回退 |
| SKL-09 | 删除全局定义 | 全局选中 `Beta` | `删除` → `确认删除` | `[TOAST]` `已删除 beta（全局定义）`；`[DISK]` 全局 skills 无 beta；引用它的 group items 被清除；`撤销` 仅本地恢复 | P0 | 删除会清组引用（`removeGroupRefs`）；撤销不落库 |
| SKL-10 | 工作区删除=本层停用 | 工作区 A 选中 `Beta`（无本地覆盖） | `删除` → `确认停用` | `[TOAST]` `已在本工作区停用 beta（全局定义仍保留）`；`[DISK]` 工作区 store 新增 `enabled=false` 覆盖；全局 beta 仍在 | P0 | 按钮文案 `在本层停用`，不是删除 |
| SKL-11 | 删除工作区覆盖 | 工作区 A 选中 `Alpha（工作区覆盖）` | 删除并确认 | `[TOAST]` `已删除 alpha（当前工作区覆盖）`；`[DISK]` 工作区 alpha 消失，`g-ws` 引用清除；全局 alpha 恢复可见（继承） | P0 | 删除本地覆盖后自动回退全局定义 |
| SKL-12 | 复制到全局（纯复制） | 工作区 A 选中 `Gamma` | 点 `复制到全局` | `[TOAST]` `已复制到全局：gamma`；`[DISK]` 全局 skills 新增 gamma（scope global、无 wsId）；工作区 gamma 保留；`[REV] +1` | P0 | 纯复制，不是移动；同名在目标存在时覆盖（服务端 upsert） |
| SKL-13 | 复制到当前工作区 | 全局选中 `Beta`（目标默认第一个工作区） | 点 `复制到当前工作区` | `[TOAST]` `已复制到当前工作区：beta`；`[DISK]` 工作区 store 新增 beta；全局保留 | P1 | 在全局作用域时目标取 `meta.workspaces[0]`，多工作区时不稳定（LIM-09） |
| SKL-14 | 迁移弹窗校验 | 全局，选中 1 个技能 | 点 `复制到…` → 不选目标直接 `执行复制` | `[DOM]` `#migTarget` 默认 `— 选择 —`；提示 `请选择目标工作区`；弹窗不关闭；`[REV]` 不变 | P1 | 目标列表排除当前工作区 |
| SKL-15 | 迁移执行（v1 仅本地） | 全局，选中 `Alpha`，目标工作区 A | 选目标 → 勾选技能 → `执行复制` | `[TOAST]` `已复制 1 项到 <title>`；**v1：`[RPC]` 无写命令、`[DISK]` 工作区 skills 不含 alpha**（`runMigrate` 只改内存）→ LIM-16；弹窗关闭、选择清空 | P0 | 目标已有同名时内存里跳过，toast 追加 `，跳过 M 项同名定义`；后续契约见清单 `SKL-22` |
| SKL-16 | 添加技能（.md 文件） | 在工作区文件系统准备 `import-test.md`（含 frontmatter） | `+ 添加` → `选择 .md / .zip 文件`，用浏览器上传该文件 | `[TOAST]` `已添加 1 个技能到<当前作用域>`；列表出现 slug 化名字；`[REV]` 不变；`[DISK]` 通常不写（导入是前端解析） | P1 | **已知缺陷**：`addSkillsFromFiles` 只改本地 state，未发 `skill.save`；刷新丢失（LIM-10） |
| SKL-17 | 添加重名跳过 | 已有 `alpha` | 上传同名 `alpha.md` | `[TOAST]` `没有可添加的技能（当前作用域已有同名定义）` 或追加 `跳过 1 个`；列表不重复 | P2 | 无 |
| SKL-18 | SKILL.md 预览 | 选中 `Alpha` | 点 `预览` | `[DOM]` 预览区出现 frontmatter（`name:`/`description:`/`invocation:` + `# Alpha`）与正文 `技能正文甲`；`aria-selected=true`；`[REV]` 不变 | P0 | 预览是渲染后的 Markdown，不是原文 |
| SKL-19 | SKILL.md 原文精确 | 选中 `Alpha` | 点 `原文` | `[DOM]` `pre.md-raw[data-skillraw]` 文本与 store `skill.text` 经 `skillFile()` 拼接一致（含 frontmatter）；只读、无保存按钮 | P0 | 原文由 `skillFile()` 生成，不是磁盘字节 |
| SKL-20 | 打开目录 | 选中 `Alpha` | 点 `打开目录` | `[TOAST]` 出现 `copy.skillDir` 文案（全局/工作区路径）；`[REV]` 不变；`[DISK]` 无变化 | P2 | 无宿主副作用，仅提示 |
| SKL-21 | 批量选择与迁移预选 | 全局技能页 | 勾选 2 个技能 → 点批量 `复制` | `[DOM]` 底部 `已选 2`；迁移弹窗中这 2 个已勾选；`清空` 清空选择 | P2 | 无 |
| SKL-23 | DSH 技能注册表内联目录（只读） | DSH 全局至少注册 1 个技能；受信任工作区注册 1 个项目技能；另有未信任工作区 | 打开技能页（应自动加载，无需点扫描）；看「DSH 技能」段 `[data-dshitem]`；点顶部 `[data-sktool=refresh]`；点一个 DSH 技能行；切到未信任工作区技能页 | `[DOM]` 技能页出现「DSH 技能」段；行显示 name/description/来源 label/provider，无 checkbox；刷新按钮在加载中显示「刷新中…」；点行后 `[data-dsh-pane]` 显示来源、作用域、调用策略、说明与路径，且没有启停/复制/删除按钮；未信任工作区只显示全局项并出现 `[data-dsh-restricted]`；`[REV]`/`[DISK]` 不变 | P1 | 只读：数据来自宿主 `ctx.skills`，不导入、不启停、不写 DSH 技能目录，也不进入 store；工作区项目技能依赖 `cwd`，未信任时不读取；不展示 SKILL.md 正文 |

### 3.6 MCP 服务器（MCP）

| ID | 功能/场景 | 前置数据 | 操作步骤 | 可观察断言 | P | 已知限制 |
|---|---|---|---|---|---|---|
| MCP-01 | MCP 列表 | Fixture G，全局 | 看 MCP 页 | `[DOM]` `Alpha MCP`：meta `1/2 工具 · stdio`、dot on；`Off MCP`：`未连接 · http`、dot off；scope tag `全局` | P0 | 不实际连接宿主，状态来自 store |
| MCP-02 | 搜索过滤 | 全局 MCP 页 | `#mcpSearch` 输入 `off` | `[DOM]` 仅 `Off MCP`；无匹配显示 `没有匹配的服务器` | P1 | 匹配 name+label+url+command |
| MCP-03 | 选择服务器打开面板 | 选中 `Alpha MCP` | 观察编辑器 | `[DOM]` 标题 `Alpha MCP`；tag `全局定义`；状态 chip `connected`；meta `2 个（1 deny）`、`配对段 mcp:alpha-mcp · 120 tok`、`stdio · node`；说明 `示例服务器说明` | P0 | 无 |
| MCP-04 | 工具开关即时生效 | MCP-03 | 点 `write` 复选框 | `[DOM]` 勾选状态翻转，meta 变 `启用`/`已 deny`；`[RPC]` `mcp.tools` 已发，`tools[write].on=true`；`[REV] +1`；`[DISK]` 更新；预览 `工具 deny` 计数变化 | P0 | 工具开关不等“保存工具清单” |
| MCP-05 | 全选/全不选 | MCP-03 | 点 `全选`，再点 `全不选` | `[DOM]` 所有过滤内工具勾选/取消；`[RPC]` 每次 `mcp.tools`；`[REV]` 每次 +1 | P1 | 作用于当前过滤结果 |
| MCP-06 | 工具过滤 | MCP-03 | `#toolSearch` 输入 `wr`，点 `全不选` | `[DOM]` 仅 `write` 可见并被取消；`search` 保持 on；`[RPC]` 数组只改过滤内项 | P2 | 过滤不影响未显示项 |
| MCP-07 | 测试连接（无探测接口，诚实错误） | 生产宿主（`probe` 未注入） | 点 `测试连接` | `[DOM]` 按钮短暂 `测试中…`；随后 `testMsg` = `宿主未提供 MCP 探测接口`；`[TOAST]` `未接入 MCP 探测`；状态保持 `connected`（fixture 值）；`[REV]` 不变；**不会伪造 connected/工具** | P0 | 生产永远走此分支（LIM-02）；接缝存在但宿主未提供 |
| MCP-08 | 测试连接不改继承定义 | 工作区 A 选中覆盖的 `alpha-mcp` | 点 `测试连接` | `[TOAST]` 追加 `（继承定义未被改写）` 仅当无本地定义；有本地覆盖时不追加；`[DISK]` 不变 | P2 | 由 `local` 是否存在决定 |
| MCP-09 | 添加 stdio 服务器 | 全局 | `+ 添加`，填名称 `demo`、命令 `npx`、参数 `-y`、env `TOKEN=abc`，保存 | `[TOAST]` `已添加 demo，点「测试连接」拉工具清单`；`[REV] +1`；`[DISK]` store 有 demo（`envKeys:["TOKEN"]`，无 env 值）；`secrets.json` 有 `env.TOKEN=abc`；`[RPC]` snapshot 的 demo 无 `env` 字段 | P0 | secrets 只在 secrets.json（见 DAT-01） |
| MCP-10 | 添加 HTTP + Bearer | 全局 | 选 HTTP，地址 `https://example.com/mcp`，认证 Bearer，令牌 `tok-1`，保存 | `[DISK]` store `headerKeys:["Authorization"]`；`secrets.json` headers 含 `Bearer tok-1`；`[RPC]` snapshot 无 headers 值 | P0 | 无 |
| MCP-11 | URL 校验 | 添加表单，HTTP | 清空地址点保存；再填 `ftp://x` 点保存 | `[DOM]` `请填写服务器地址`；`地址必须以 http:// 或 https:// 开头`；`[data-saveserver]` 保持 disabled；`[REV]` 不变 | P1 | 校验只在 submit 后显示 |
| MCP-12 | 名称校验与重名 | 添加表单 | 名称留空；填 `alpha+mcp`；填 `alpha-mcp` | `[DOM]` `请填写名称`；`只能包含字母、数字、下划线或连字符，1-32 位（不支持空格、点、中文）`；重名保存时 `div.form-err` 显示 `当前作用域已有同名服务器：alpha-mcp`；弹窗不关 | P1 | 重名错误由 `saveServer` 本地判断，不发 RPC |
| MCP-13 | 编辑并重命名（v1 只发 mcp.save） | 选中 `alpha-mcp` | `编辑配置`，名称改 `alpha2`，保存 | `[TOAST]` `已保存 alpha2`；**v1：只发 `mcp.save`，磁盘留下旧 `alpha-mcp` + 新 `alpha2`，组引用不变**（LIM-17）→ 记 KNOWN-DEFECT；选择在刷新后回到宿主快照 | P0 | 重命名只同步本地组引用与选择；后续契约见清单 `MCP-23` |
| MCP-14 | 编辑 transport 切换 | 选中 `alpha-mcp` | 编辑 → 切 HTTP，填 URL，保存 | `[DISK]` url 有值、command/args 被移除；再切回 stdio 则 url 移除、command 保留 | P1 | 反向切换会丢 url，属预期 |
| MCP-15 | 已配置密钥留空保留 | MCP-09 后 | 编辑 demo，环境变量行留空保存；再开编辑 | `[DISK] secrets.env.TOKEN` 仍是 `abc`；`[DOM]` secret note `已配置 1 个环境变量（值不读出，留空即保留）` | P0 | 空值不会清空既有密钥；`null` 才删除 |
| MCP-16 | 删除密钥两步 | 编辑 demo | 点密钥行 `删除`，再点 `确认删除`，保存 | `[DOM]` 第一击变 `确认删除`（4s 自动取消）；保存后 `[DISK]` `envKeys` 不含 TOKEN，`secrets.json` 该键被删除 | P1 | 第二次点击才真正进入待删集合 |
| MCP-17 | 原文只读 | 选中 `alpha-mcp` | 点 `查看原文` | `[DOM]` `textarea#fRaw` 有 `readonly`；文本含 `kind: mcp-server`、`serverName: alpha-mcp`、`transport: stdio`；关闭弹窗后 `[REV]` 不变、`[DISK]` 不变 | P0 | 弹窗只读，不写回；修改必须走“编辑配置” |
| MCP-18 | 停用服务器 | 选中 `alpha-mcp` | 点 `停用` | `[TOAST]` `已停用 alpha-mcp（全局）`；`testMsg` `已停用：全部 mcp__alpha-mcp__* 工具从这份定义里消失。`；`[DISK] enabled=false`；预览 MCP 行 `已停用`；预算不再含 120；按钮变 `启用` | P0 | 停用服务器 ≠ deny 单工具 |
| MCP-19 | 工作区停用（copy-on-write） | 工作区 A 选中无本地覆盖的服务器 | 删除 → `确认停用` | `[TOAST]` `已在本工作区停用 <name>（全局定义仍保留）`；`[DISK]` 工作区 store 新增覆盖 `enabled=false`；全局不变 | P1 | 无 |
| MCP-20 | 删除全局服务器 | 全局选中 `Off MCP` | 删除 → 确认 | `[TOAST]` `已删除 off-mcp（全局定义）`；`[DISK]` store 无该服务器；`secrets.json` 对应键被删；组引用清除；撤销仅本地 | P1 | `deleteSecrets` 仅在存在 secrets 记录时写 |
| MCP-21 | OAuth 登录/断开 | 先添加 auth=oauth 的服务器 | 点 `OAuth 登录`，再点 `断开登录` | `[TOAST]` 分别 `copy.oauthOn`/`copy.oauthOff`；`[DISK] oauth` 翻转；按钮文案切换 | P2 | 无真实 OAuth 流程，仅状态位 |
| MCP-22 | 重启连接 / 加入分组 | 选中 `alpha-mcp` | 点 `重启连接`；点 `加入分组` | `[TOAST]` `重启连接` 直接给 copy.restart 提示；加入分组后当前组出现该服务器（若未保存则仅本地） | P2 | 重启无宿主副作用（前端提示） |

### 3.7 预算、诊断、预览与复制（SUM）

| ID | 功能/场景 | 前置数据 | 操作步骤 | 可观察断言 | P | 已知限制 |
|---|---|---|---|---|---|---|
| SUM-01 | 预算卡总量 | Fixture G 默认生效 | 看右栏 | `[DOM]` `[aria-label=上下文预算]`；数字 `130 / 200K tok`；`div.budget-bar[role=img][aria-label='生效内容构成占比，共 130 tok']`；状态 `余量充足`；脚注 `<1% 预算 · 估算` | P0 | 200K 是固定估算常量（`CONTEXT_BUDGET`），非宿主真实上下文 |
| SUM-02 | 预算构成 | SUM-01 | 看图例 | `[DOM]` 图例 `上下文 0`、`提示词段 0`、`技能 5`、`MCP 120`、`自定义 5`；零值项带 `zero` 样式 | P0 | 上下文段永远 0（LIM-01） |
| SUM-03 | 预览内容与自定义 | SUM-01 | 往下看 | `[DOM]` `pv-head ✓ 基础组`、tag `全局`、`≈ 125 tok`；`技能 1` 行 `alpha`；`MCP 服务器 1` 行 `mcp:alpha-mcp`；`自定义提示词 1` 行 `自定义 · 回答风格`；`工具 deny 1`、`技能遮蔽 3` | P0 | 无 |
| SUM-04 | 诊断列表 | SUM-01 | 点 `诊断` 页签 | `[DOM]` `span.n` = `3`；条目：`本组没有包含提示词段`（info）、`有工具被 deny`（warn，含 action `查看工具`）、`有技能被分组遮蔽`（info，action `查看技能`） | P0 | 计数随生效组变化 |
| SUM-05 | 诊断空态 | 构造干净夹具：组只含启用且连接中的资源、无 deny、无遮蔽（如仅 1 个启用技能且全组可见） | 点 `诊断` | `[DOM]` `没有发现问题` + `生效集合、工具状态与预算都在预期范围内。` | P1 | 需要额外夹具，不建议改主夹具 |
| SUM-06 | 缺引用诊断 | 选 `缺引用组` 并 `设为生效` | 点 `诊断` | `[DOM]` 3 条 error：`分组引用了不存在的提示词段`、`…技能`、`…MCP 服务器`；预览该组项显示 `缺失`；预算 5 tok（仅自定义） | P1 | 缺失项不进入生效正文 |
| SUM-07 | 停用资源诊断 | 选 `停用组` 并 `设为生效` | 点 `诊断` | `[DOM]` `分组内部分 MCP 服务器已停用`（warn）与 `分组内部分技能已停用`（info）；预算 5 tok（仅自定义）；预览行 `已停用 · 不计入预算` | P1 | 需夹具含停用项，已具备 |
| SUM-08 | 空组诊断 | 选 `空组` 并 `设为生效` | 点 `诊断` | `[DOM]` `生效分组是空组`（warn），action `编辑分组`；预算 `5 / 200K tok`（仅自定义）；预览 `没有选入…` | P1 | 空组与“无提示词段”不会同时出现（空组先命中） |
| SUM-09 | 预算警戒/超限 | 另建夹具：把 `alpha-mcp.tokens` 改为 `185000`（revision 任意），`g-base` 生效 | 看预算卡 | `[DOM]` `185010 / 200K tok`；class `danger`；状态 `超过 90%，建议拆分`；诊断 `上下文预算偏紧`（error） | P2 | 需要修改夹具；`tokens` 是夹具字段，不是实测 |
| SUM-10 | 链节点切换作用域 | 工作区 A 继承全局 | 点预览链上的 `全局` 节点 | `[DOM]` scope 切回全局（`aria-current`）；面包屑 `全局`；页签 `6 / 4 / 2` | P1 | 链节点只显示当前链（未信任时只有全局） |
| SUM-11 | 复制生效内容 | SUM-01 | 点 `复制生效内容` | `[TOAST]` `已复制生效内容`；剪贴板（如可读）包含 `# 生效分组：基础组`、`技能正文甲`、`示例服务器说明`、`## 自定义：回答风格` | P1 | 剪贴板权限/权限策略失败时改为 `复制失败，请检查剪贴板权限`（LIM-11） |
| SUM-12 | 无组时复制 | 全局 `不使用分组` | 点 `复制生效内容` | `[TOAST]` `当前没有可复制的生效内容`；剪贴板不变 | P1 | 自定义在无组时仍可能进入正文；提示优先 |
| SUM-13 | context / section 预算口径 | 生产宿主 | 看预算卡图例与组编辑器 `提示词段` 区 | `[DOM]` `上下文 0`、`提示词段 0`；`[RPC] snapshot.bootstrap.sections=[]`；组编辑器 `提示词段` 显示空态；无任何 section token 进入总量 | P2 | **不可端到端测**：宿主不传 sections（LIM-01）；只能证明“空即不计入”，不能验证非空分组 |

### 3.8 数据安全、revision、并发与持久化（DAT）

| ID | 功能/场景 | 前置数据 | 操作步骤 | 可观察断言 | P | 已知限制 |
|---|---|---|---|---|---|---|
| DAT-01 | secrets 不落 store | MCP-09 已保存 `TOKEN=abc` | 读全局 `store.json` 与 snapshot | `[DISK]` store.json 不含 `abc`，只有 `envKeys`；`[RPC]` snapshot 的 servers 无 `env`/`headers` 字段；`secrets.json` 才含明文 | P0 | 安全边界：store 可分发，secrets 不可 |
| DAT-02 | secrets 文件权限 | 同上（POSIX） | `stat -c %a secrets.json` | `[DISK]` 期望 `600` | P2 | Windows 上 mode 不生效，跳过或记录为不适用 |
| DAT-03 | revision 冲突拒绝 | 页面已加载（当前 `R0`） | curl 用 `expectedRevision:R0` 保存一次（成功，变 R0+1）；页面再点 `保存草稿` | `[TOAST]` `保存失败：revision conflict: expected R0, current R0+1`；`[DISK]` 只保留 curl 的改动；`[REV]` 不因页面失败而变 | P0 | 页面必须刷新才能拿新 revision |
| DAT-04 | trust.set 不受 revision 约束 | 当前 `R0` | curl dispatch `{"type":"trust.set","workspaceId":"<WS_ID>","trusted":true,"expectedRevision":0}` | `[RPC]` 200 `ok:true`；`[REV] R0+1`；`[DISK] trusted=true` | P2 | 唯一跳过 revision 校验的命令 |
| DAT-05 | 工作区写双文件 revision | 工作区已信任 | 在工作区保存一个自定义 | `[DISK]` 工作区 store `revision+1` **且** 全局 store `revision+1`；其他工作区不受影响 | P0 | 服务端先写工作区、再写全局（LIM-06） |
| DAT-06 | 重启后持久化 | 已做若干保存 | 重启 `dsh web`（或重启宿主进程），重开面板 | `[DOM]` 数据、生效组、信任状态与重启前一致；`[RPC] revision` 保持；`[DISK]` 无临时文件残留 | P1 | 需要按 t1 的启动命令重启；不做就无法声称持久化 |
| DAT-07 | 备份保留 | 多次保存 | 看 `$DSH_HOME/dsh-csmm/backups/` | `[DISK]` 出现 `store-<rev>-<iso>.json`；数量 ≤10；每次写前生成 | P2 | 备份策略按实现，最多保留 10 份 |
| DAT-08 | 锁冲突 | 手动创建 `store.lock`（内容 `{"pid":1,"at":...}`） | 页面保存 | `[TOAST]` `保存失败：store is locked: <path>`；`[DISK]` 无写入；删除锁后重试成功 | P2 | 手工制造锁；真实并发锁不易稳定复现 |
| DAT-09 | 原子写/无残留 tmp | 多次保存 | `ls $DSH_HOME/dsh-csmm/` | `[DISK]` 无 `*.tmp` 残留；store 文件可被 JSON.parse | P2 | 无法注入崩溃，只能事后检查 |
| DAT-10 | 空 store revision=0 | 删除全局 store | 刷新 | `[RPC] revision=0`；`[DOM]` 空态（同 SCOPE-05）；首次保存后 revision=1 | P1 | 删除前必须备份 |
| DAT-11 | 全局/工作区域写隔离 | 两台工作区或一个工作区 | 全局保存分组；工作区保存自定义 | `[DISK]` 全局写不创建/修改工作区文件；工作区写不改其他工作区文件；对应 store 各自 revision +1 | P0 | 全局写只写 `$DSH_HOME/**`；工作区写只写 `<root>/.dsh/**` 加全局 revision 记帐 |

### 3.9 响应式、主题与基本无障碍（UX）

| ID | 功能/场景 | 前置数据 | 操作步骤 | 可观察断言 | P | 已知限制 |
|---|---|---|---|---|---|---|
| UX-01 | 四栏布局与 landmark | 面板已加载 | a11y 树 | `[DOM]` `nav[aria-label=作用域]`、`nav[aria-label=列表]`、`main[aria-label=编辑]`、`aside[aria-label=生效预览]`；页签 `role=tablist`，每个 tab `role=tab` + `aria-selected` | P0 | 四栏在窄屏折叠 |
| UX-02 | 编辑区焦点管理 | 选中分组 | 观察焦点 | `[DOM]` `main[aria-label=编辑]` 有 `tabindex=-1`，切换 detail/tab/active 时焦点进入主区（便于键盘继续操作） | P2 | 需用键盘观察，自动化只能断言属性 |
| UX-03 | 键盘操作 | 选中分组 | Tab 到 `保存草稿`，按 Enter；Space 切复选框；Ctrl+S | `[DOM]` 保存触发同一 toast；复选框状态翻转；Ctrl+S 仅在无弹窗时保存 | P1 | 无 |
| UX-04 | 弹窗焦点陷阱 | 打开任意弹窗 | 连续 Tab/Shift+Tab；Escape | `[DOM]` 焦点在弹窗首尾循环，不逃到背景；Escape 关闭且焦点返回触发元素；背景 `aria-modal=true` | P1 | 只有 `.modal` 存在时陷阱生效 |
| UX-05 | focus-visible 可见 | 键盘 Tab | 观察焦点环 | `[DOM]` 焦点元素出现 `outline: 2px` 主题色（`styles.css` 的 `:focus-visible`） | P2 | 截图/像素判定依赖人工 |
| UX-06 | 响应式断点 | 桌面窗口 | 缩窄到 <1180、<960、<640 | `[DOM]` 1180 以下列宽收紧；960 以下变单列（四栏纵向堆叠）；640 以下 MCP 表单单列；无横向溢出 | P2 | 浏览器工具没有 viewport 设置接口，需人工拖拽窗口；自动化只能做静态 CSS 检查 |
| UX-07 | 空/加载/错误态 | 分别见 SCOPE-05、ENV-06、ENV-07 | 打开面板 | `[DOM]` 空态文案齐全；错误态 `CSMM 后端未连接：…` + `重试`；加载态 `正在加载 CSMM 配置…` | P1 | 加载态太快，通常不可稳定断言；错误态需停 host |

## 4. 已知限制与不可测项（按影响排序）

| 编号 | 限制 | 证据/位置 | 对测试的影响 |
|---|---|---|---|
| LIM-01 | 生产宿主永远 `sections: []`：没有提示词段/运行上下文数据 | `src/host/index.ts:96`（`new CsmmService({ ..., sections: [] })`）；`GroupEditor.tsx:245`（按钮渲染条件） | 提示词段白名单、`全选/清空`、context 预算、`分组引用了不存在的提示词段` 以外的 section 场景都无法端到端覆盖；夹具也无法注入（服务从 options 读，不读 store）。清单 `CTX-01` 的 v1 口径是**负向通过（PASS）**，不是 KNOWN-DEFECT；materialize 缺口只在 `GRP-06` 记 KNOWN-DEFECT |
| LIM-02 | 生产从不注入 `probe`：测试连接恒为诚实错误 | `src/host/index.ts:96`；`src/host/http.ts` 的 `if (!deps.probe)` 分支 | 无法验证 connected/工具拉取成功路径；只能验证“未接入 MCP 探测”这条正确失败路径 |
| LIM-03 | 全局页不展示工作区技能/服务器；工作区页展示覆盖后的单条记录 | `src/UI/model/selectors.ts` 的 `visibleSkills/visibleServers` | 同名覆盖只能用“单条记录 + 覆盖文案”断言，不能看到两个作用域并排 |
| LIM-04 | 暂不信任只记在 UI 内存 `trustDeclined`，不落库 | `src/UI/viewmodel/state.ts`、`useAppViewModel.tsx` | 刷新会再次弹信任弹窗；不能测试“重启后仍拒绝” |
| LIM-05 | `保存并设为生效` 只发 `group.effective`，不保存草稿 items | `src/UI/viewmodel/actions/navigation.ts:20-43`；`GroupEditor.tsx:245` | 脏草稿 + 设为生效会丢 items；必须用“先保存草稿，再设为生效”规避，矩阵把该行为当已知缺陷断言 |
| LIM-06 | 工作区写会同时写工作区 store 和全局 store（记帐 revision） | `src/host/service.ts` 的 workspace 分支 | 断言工作区写必须同时检查两个 revision +1；不要误判为跨域写违规 |
| LIM-07 | 删除的 undo 只恢复本地 state，不发 RPC | `src/UI/viewmodel/actions/library.ts:125-160` | “撤销后持久化”不可测（实际不持久化）；只能测本地恢复 + 刷新后消失 |
| LIM-08 | `加入分组`/资源面板的成员变更在无草稿时直接改本地 items，不发 RPC | `src/UI/viewmodel/actions/library.ts` 的 `setGroupItem/addSkillsToGroup` | 这些操作刷新即丢；矩阵只断言本地效果与已知限制 |
| LIM-09 | 全局作用域“复制到当前工作区”取 `meta.workspaces[0]` | `src/UI/viewmodel/actions/resources.ts` 的 `moveSkill` | 多工作区时目标不确定；测试固定单工作区 |
| LIM-10 | 技能导入（文件/目录）只改本地 state，不落库 | `src/UI/viewmodel/actions/resources.ts` 的 `addSkillsFromFiles` | 刷新丢失；目录上传（`webkitdirectory`）在浏览器自动化里也难以驱动，标 P2/人工 |
| LIM-11 | 复制生效内容依赖 `navigator.clipboard` 与权限 | `src/UI/view/components/Preview.tsx` 的 `copy()` | 非安全上下文/权限拒绝时只能断言错误 toast；不要把剪贴板内容当唯一证据 |
| LIM-12 | 响应式断点与主题无法用当前浏览器工具设置 viewport/媒体特性 | `src/UI/styles.css` 的 `@media (max-width:1180/960/640)`、`prefers-color-scheme` | 只能人工拖窗或做静态检查；自动化标 P2 |
| LIM-13 | `npm test` 只跑 `tests/shared` 与 `tests/host`，不含 UI/viewmodel 测试 | `package.json` 的 `scripts.test` | 声称“全部测试通过”不等于 UI 已验证；浏览器矩阵是 UI 的唯一证据 |
| LIM-14 | 宿主启动时若 `workspaceRegistry` 解析不到工作区，`snapshot` 不绑定工作区 | `src/host/index.ts` 的 `resolveByPath`/fallback | 先确认作用域栏有 `<WS_ID>`；否则工作区写全部 `E_APPLY no workspace binding` |
| LIM-15 | 信任状态存于全局 store 的 `workspaces[].trusted`，不是 `trust.json` | `.omd/specs/…`、`src/host/service.ts` | 不要按旧 SPEC 去找 `$DSH_HOME/trust.json`；矩阵按 store 断言 |
| LIM-16 | 技能迁移 `runMigrate` 只改本地 state、不发 RPC（`src/UI/viewmodel/actions/modals.ts:17-40`） | 代码审读 + t4 评审 F1 | `SKL-15` 只能断言 toast 与“磁盘无变化”；刷新后副本消失；后续契约见清单 `SKL-22` |
| LIM-17 | MCP 重命名只本地改组引用且只发 `mcp.save`；host 按新名 upsert、不删旧、不改组引用（`modals.ts:105-125`、`src/host/service.ts:179-197`） | 代码审读 + t4 评审 F2 | `MCP-13` 断言磁盘出现新旧两条、组引用仍是旧名；后续契约见清单 `MCP-23` |

## 5. P0 冒烟集（最少必跑 20 条）

按顺序执行，可在 30–40 分钟内完成一轮：

1. ENV-02 面板四栏加载
2. ENV-03 RPC snapshot 形状
3. ENV-08 revision 基线
4. ENV-09 页签计数与徽标
5. SCOPE-01 默认全局
6. SCOPE-03 切已信任工作区
7. GRP-01 默认生效预览（130 tok）
8. GRP-03 保存草稿（revision +1 + 磁盘）
9. GRP-05 设为生效（activeGroup）
10. GRP-06 脏草稿“保存并设为生效”缺陷复现（依赖第 9 步 `activeGroup=g-empty`，否则无 `[data-effective]`）
11. GRP-07 工作区继承全局
12. GRP-08 显式不使用分组
13. GRP-11 覆盖提示
14. GRP-12/13 同名技能与 MCP 覆盖
15. SKL-05 全局启停
16. SKL-07 工作区 copy-on-write 停用
17. SKL-18/19 预览与原文
18. MCP-04 工具开关
19. MCP-07 测试连接诚实错误
20. MCP-17 原文只读
21. CUS-02 保存自定义
22. CUS-04 逐条启停
23. SUM-01/04 预算与诊断
24. DAT-01 secrets 不落 store
25. DAT-03 revision 冲突
26. TRUST-01～TRUST-04（信任闭环）
27. ENV-06 错误态（可选，需停 host）

## 6. 执行注意

- **revision 是全局 store 的**，工作区写也会让它 +1；每步操作前重新读 `snapshot.revision`，不要沿用上一步的值。
- **工作区写需要信任**：TRUST 用例跑完后必须恢复 `trusted:true`，否则后续工作区用例全部 `E_TRUST`。
- **fixture 恢复**：每轮跑完用备份恢复 `$DSH_HOME/dsh-csmm/` 与 `<WSROOT>/.dsh/`；`backups/` 可保留供取证。
- **浏览器操作**：优先用语义定位（`dsh_browser_a11y`/`dsh_browser_click` 的 text/css target），不要依赖像素坐标；弹窗打开时先断言 `#modalTitle` 再点按钮。
- **两阶段删除**：删除分组/技能/MCP 都需要第二次确认；每次确认后断言 `[DISK]` 与 `[REV]`，避免“点击了但没落库”被当成成功。
- **诚实失败**：测试连接、无探测、剪贴板失败都按“预期错误文案”断言，不要把它当功能缺失；反之，`保存并设为生效`/撤销/导入这类本地-only 行为要按已知缺陷记录，不要写成通过。
- 若宿主重启后 `<WS_ID>` 变化（不同工作区/不同 registry），需要重新写 fixture 的 `wsId` 与 `id` 字段并重跑；矩阵中的 `<WS_ID>` 始终以当前 UI 读到的为准。
