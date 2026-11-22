# dsh-csmm 浏览器测试 SOP（t3）

> 本文件是 `t3` 交付物之二：从干净环境到出报告的完整标准作业流程。用例与判定口径见 `docs/TEST-CHECKLIST.md`（下称清单）；128 条完整断言见 `docs/BROWSER-TEST-MATRIX.md`（下称矩阵）；环境事实见 `D:\Temp\csmm-webtest-recon-env.md`（t1）。
>
> 实测声明：2026-11-22 已实测 **§1.2 安装、§1.3 启动、§1.4 四连验证、§3.2 CSMM 挂载、§3.6 页面内 RPC**（空 store，revision 0）；**§2.3/§2.4 的夹具播种与基线数值尚未执行**，其余步骤是脚本化待执行项，首次执行者应在报告里注明“首次执行”。

| t3 要求的 SOP 组成 | 所在节 |
|---|---|
| 环境：版本、profile、启动/端口/认证 URL、安装启用与验证 | §1.1–§1.4 |
| 数据：global/workspace store 与注册表播种、不可伪造路径、隔离 | §2.1–§2.4 |
| 浏览器：`dsh_browser_*` 调用顺序、DOM/文本/属性断言、React flush、截图 | §3.1–§3.5 |
| 执行：每个 P0 的脚本化步骤与失败判定（61 条） | §4 |
| 证据与报告：日志/截图/RPC/store diff 的采集与命名 | §5 |
| 清理：杀进程、删临时目录、保留审计产物 | §6 |
| 已知不可测项（路由未装、MCP probe、sections 为空等） | §7 |

## 1. 环境

### 1.1 版本与路径核对

```bash
dsh --version                                # 期望 0.2.2-rc.2
export DSH_HOME="${DSH_HOME:-E:/Code/_0_DSH/.dsh}"   # 全篇先用；Windows 等价 E:\Code\_0_DSH\.dsh
echo "$DSH_HOME"                             # 期望 E:/Code/_0_DSH/.dsh（§2.3/§6 直接复用，不再重复定义）
ls "$DSH_HOME/profiles"                      # 期望含 web
grep -n '"dsh-csmm"' "$DSH_HOME/profiles/web/package.json" || true
netstat -ano | grep ':3080' | grep LISTENING || echo "port free"
```

`profile` 必须是 `web`（`dsh --profile web` 等价于 `dsh web`）。默认端口 `3080`，默认绑定 `127.0.0.1`。

### 1.2 安装 / 启用插件（允许修改 web profile）

```bash
cd /e/Code/_dev_skill_mcp/dsh-csmm
pnpm build                                   # 必须先生成 dist/index.js 与 dist/client.js
mkdir -p /d/Temp/csmm-sop-backup
cp "$DSH_HOME/profiles/web/package.json" "/d/Temp/csmm-sop-backup/web-package.json.$(date +%s)"
dsh plugin --profile web add "E:\Code\_dev_skill_mcp\dsh-csmm"

# 装包命令只负责装包/加依赖；bundles 必须手工确认（t1 结论：它只转发 pnpm，不改 bundles）
node -e '
const fs=require("fs");
const f=process.env.DSH_HOME+"/profiles/web/package.json";
const p=JSON.parse(fs.readFileSync(f,"utf8"));
p.dsh=p.dsh||{}; p.dsh.profile=p.dsh.profile||{};
const b=p.dsh.profile.bundles=p.dsh.profile.bundles||[];
if(!b.includes("dsh-csmm")) b.push("dsh-csmm");
fs.writeFileSync(f,JSON.stringify(p,null,2)+"\n");
console.log("bundles:",b.join(","));
'
```

- `dsh.profile.bundles` 是 DSH 加载 bundle 的依据；上面的脚本幂等（已有则不动），重复执行无副作用。
- **不要依赖 `dsh plugin add` 自动追加 bundles**：该行为未经复验，不作为路径；即使某些版本自动加了，也必须执行上面的确认脚本并做四连校验。

```bash
grep -n -A6 '"bundles"' "$DSH_HOME/profiles/web/package.json"   # 期望含 "dsh-csmm"
dsh --profile web --dump-config | grep -n 'dsh-csmm'            # 期望命中 bundle/插件项；无输出=未生效
```

- 若校验仍无 `"dsh-csmm"`：确认 `DSH_HOME` 指向同一 profile、重复运行上面的幂等脚本，然后重启实例并做 §1.4 四连。
- 卸载（本轮不要求；未实测）：`plugin_manager({action:'remove_bundle',target:'dsh-csmm'})` 在 web 实例会话执行，或从 `package.json` 移除 bundle 行与依赖并重启。

### 1.3 启动实例并取得认证 URL

```bash
# 1) 停掉旧实例，确认端口空闲
netstat -ano | grep ':3080' | grep LISTENING
powershell -NoProfile -Command "Get-Process -Id <PID> | Stop-Process"   # 仅停本测试实例
sleep 2; netstat -ano | grep ':3080' | grep LISTENING || echo free

# 2) 后台启动，stdout 落盘
#    agent 用 ops_bash 时优先 run_in_background=true；用普通 shell 时加 nohup，防止父 shell 退出带走子进程
rm -f /d/Temp/dsh-web-3080.log
nohup dsh --profile web --no-open > /d/Temp/dsh-web-3080.log 2>&1 &
for i in $(seq 1 15); do grep -q 'dsh web: http' /d/Temp/dsh-web-3080.log && break; sleep 1; done
grep -m1 -o 'http://127.0.0.1:3080/?token=[A-Za-z0-9_-]*' /d/Temp/dsh-web-3080.log
```

- 认证 URL 只在启动 stdout 出现（`token=randomBytes(32)` 的 base64url，内存态、不落盘）；**旧实例的 token 无法恢复**，重启即换。
- 未认证访问返回 `401 dsh web authentication required` 属预期；不要试图关闭认证（没有开关）。
- 已认证浏览器的 cookie（`dsh-auth-<authority>`，持久 secret 签名）在重启后仍有效；但**每个测试轮次仍从本次启动日志的 token URL 进入**，避免“以为登录了其实没有”。

### 1.4 校验四连（装好后的最低证据）

用 `dsh_browser_open(<token URL>)` 打开后，按顺序断言：

1. **Bundle 已注册**：`__DSH_BOOT__.entries.some(e => e.id === 'dsh-csmm')` 为 `true`。
2. **客户端已加载**：页面请求 `/plugins/??…dsh-csmm/client.js…` 返回 200；打开面板后 `style[data-dsh-csmm="true"]` 存在。
3. **入口可见**：左侧栏出现 `CSMM` 按钮，点击后主区 `.topbar` 文本含 `系统提示词`（四栏 landmark 见清单 `ENV-02`）。
4. **RPC 可用**：页面内 `fetch('/dsh-csmm/rpc', {method:'POST', …, body:'{"method":"snapshot"}'})` 返回 200 且 `ok:true`。

四连任一失败 → 停：先查 `package.json` bundles、`dist/` 是否构建、日志有无 `dsh-csmm` 加载错误、`__DSH_BOOT__` entries，再重启实例；不要在四连失败时继续播种数据。

### 1.5 可选：真正的浏览器 MCP（替代路径）

本 SOP 主线用**内置 `dsh_browser_*`**（Cordis 插件 `dsh-builtin-browser`，不是 MCP，profile `web` 不装它也能用桌面端浏览器工具）。另一条路是装一个浏览器 MCP（如 Playwright MCP / chrome-devtools-mcp），由 MCP 工具暴露 `browser_navigate`/`browser_click` 等：

- 配置成本：安装服务器包 → 在 profile 的 MCP 配置里注册（stdio 或 http）→ 重启 → 确认工具清单出现；通常需要显式 Chrome/Chromium 路径与独立 user-data-dir。
- 关键差异：**cookie 不共享**。必须先用 token URL 在 MCP 浏览器里登录一次；`dsh_browser_*` 已有的会话态不能平移。
- 未验证项：本机未安装任何浏览器 MCP（t1 侦察：所有 profile 均无），上述命令与版本兼容性**未实测**；不得在报告里声称“已验证”。适用场景是 CI、并行多实例或必须验证 MCP 工具语义时；单机人工执行仍建议内置工具。

## 2. 数据准备与隔离

### 2.1 目录与 `<WS_ID>`（唯一合法来源）

| 数据 | 路径 |
|---|---|
| 全局 store | `$DSH_HOME/dsh-csmm/store.json`（写入时创建；读不创建） |
| 全局 secrets | `$DSH_HOME/dsh-csmm/secrets.json`（0o600） |
| 备份/锁 | `$DSH_HOME/dsh-csmm/backups/`、`store.lock` |
| 工作区 store | `<WSROOT>/.dsh/<WS_ID>/store.json` |

`<WS_ID>` **只能**从 UI 作用域栏 `button[data-scope=workspace][data-id]` 或 `snapshot.bootstrap.workspaces[].id` 读取（由宿主 `workspaceRegistry` 提供，是 `randomUUID`，不是路径哈希）。仓库当前 id 为 `23848871-523a-4385-a2e3-561ead7e1904`，但每台机器/每次注册可能不同——**禁止硬编码、禁止手写 `<WS_ID>`、禁止手改 `storages/workspace.json` 来伪造工作区**。

### 2.2 测试工作区与隔离

- **首选**：直接用本仓作为 `<WSROOT>`（已注册、id 可读）；仓库 `.dsh/` 已加入 `.gitignore`（t3 已改），测试不会污染提交。
- **备选**：临时目录（如 `D:\Temp\csmm-ws`）必须先作为工作区在 DSH 里打开/注册，然后从作用域栏读新 id；不能只建目录就当工作区（host 的 `resolveByPath` 解析不到会退化为无绑定，写操作报 `E_APPLY no workspace binding`）。
- 全局 store 是共享的：本 SOP 用备份/还原保证可逆（不提供“独立全局目录”的假路径，因为换 `DSH_HOME` 会同时丢掉 workspace registry 与 sessions）。
- 不允许伪造：没有夹具替身能提供 `sections`（host 恒传 `sections: []`）；没有 `probe` 能提供 MCP 探测；信任状态在 store 的 `workspaces[].trusted`，不是 `$DSH_HOME/trust.json`。这些只能在报告里标为 LIM，不能造假数据绕过。

### 2.3 备份与播种夹具

```bash
DSH_HOME="${DSH_HOME:-E:/Code/_0_DSH/.dsh}"   # 与 §1.1 同值；已 export 则沿用
WSROOT="/e/Code/_dev_skill_mcp/dsh-csmm"
WS_ID="<从 UI 作用域栏读取>"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
EVDIR="/d/Temp/csmm-evidence-$RUN_ID"
mkdir -p "$EVDIR"/{backup,shots,rpc,disk,logs}

# 备份（存在才备份；记录“原本不存在”，清理时删掉新建目录即可）
[ -d "$DSH_HOME/dsh-csmm" ] && cp -a "$DSH_HOME/dsh-csmm" "$EVDIR/backup/global-csmm"
[ -d "$WSROOT/.dsh" ]        && cp -a "$WSROOT/.dsh"        "$EVDIR/backup/workspace-dsh"
# 注意：不要删除/备份后删除 $DSH_HOME/storages/workspace.json 与 sessions/
```

**Fixture G（全局 `$DSH_HOME/dsh-csmm/store.json`，revision 10）**

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

**Fixture W（工作区 `<WSROOT>/.dsh/<WS_ID>/store.json`，revision 4）**

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

写入（保持实例运行即可，store 每次 RPC 重新读；写完刷新页面）：

```bash
mkdir -p "$DSH_HOME/dsh-csmm" "$WSROOT/.dsh/$WS_ID"
# 用编辑器或 here-doc 把上面两段 JSON 存到临时文件，再替换占位符
sed "s/<WS_ID>/$WS_ID/g" fixture-g.json > "$DSH_HOME/dsh-csmm/store.json"
sed "s/<WS_ID>/$WS_ID/g" fixture-w.json > "$WSROOT/.dsh/$WS_ID/store.json"
```

### 2.4 基线自检（不过就停）

在页面内执行（同一 COOKIE 会话）：

```js
// 先把两个值替换成实机值（WS_ID 从作用域栏读，WSROOT 用工作区绝对路径的正斜杠形式）
const WS_ID = '<作用域栏 data-id>';
const WSROOT = 'E:/Code/_dev_skill_mcp/dsh-csmm';

// A. 全局
const g = await (await fetch('/dsh-csmm/rpc',{method:'POST',headers:{'content-type':'application/json'},body:'{"method":"snapshot"}'})).json();
// 期望：g.ok===true; g.snapshot.revision===10; bootstrap.groups.length===4;
//       bootstrap.skills.length===4; bootstrap.servers.length===2; bootstrap.customs.length===2;
//       bootstrap.sections.length===0; bootstrap.activeGroup['global:']==='g-base';
//       workspaces 含 {id: WS_ID}

// B. 工作区（先点作用域栏的工作区按钮，再执行）
const w = await (await fetch('/dsh-csmm/rpc',{method:'POST',headers:{'content-type':'application/json'},
  body: JSON.stringify({method:'snapshot', scope:{kind:'workspace',id:WS_ID}, workspaceRoot:WSROOT})})).json();
// 期望：合并视图 groups=5（全局 4 + g-ws）、customs=3、skills=5（alpha 为工作区覆盖）、servers=2
//       （同名覆盖后只保留 1 条 alpha-mcp）；页签为 2 / 5 / 2
//       （提示词=本层组+自定义；技能/MCP 为合并后的可见数）
```

DOM 基线：全局 `#pageTabs` 计数 `6 / 4 / 2`；右栏 `生效合计 130 tok`、`≈ 125 tok`；切到工作区后页签 `2 / 5 / 2`。任一不符 → 检查 `<WS_ID>`、fixture 路径、`schemaVersion`、作用域是否在全局、刷新是否发生；不要带病继续。

## 3. 浏览器驱动规范（`dsh_browser_*`）

### 3.1 会话与登录

1. `dsh_browser_open(<token URL>)`（每个测试轮次都用当前实例的 token URL，不用裸 `http://127.0.0.1:3080/`）。
2. `dsh_browser_state` 确认 URL/标题/加载完成；`dsh_browser_a11y` 拿角色/名称。
3. 面板入口：`dsh_browser_click {by:'text', value:'CSMM'}`；随后 `dsh_browser_assert {js:"!!document.querySelector('.topbar')"}`。点击前若 `.topbar` 已存在说明面板已挂载，不要重复点。

### 3.2 标准调用顺序

```
a11y（定位）
 → assert（前置成立：selector/文本/URL/js）
 → click / check / fill / select（语义 target，不用坐标）
 → wait（等 selector 或 URL；toast 用短轮询）
 → assert / get_value（验证结果，而不是“我点了”）
 → screenshot（存 EVDIR）
 → 需要磁盘/RPC 证据时再取（页面内 fetch / 读文件）
```

批量步骤用 `dsh_browser_do`（最多 40 步，遇错即停）；列表页可用 `dsh_browser_scrape`，但 CSMM 列表是 `data-*` 属性驱动，通常 `a11y` + `evaluate` 取计数更稳。

### 3.3 断言 DOM / 文本 / 属性

- 结构：`dsh_browser_assert {selector:"nav[aria-label=作用域]"}`。
- 文本：`dsh_browser_assert {text:"已保存并设为生效：空组"}`；精确文本优先用 `dsh_browser_find`（返回位置与上下文）。
- 属性/计数：`dsh_browser_execute` 返回 JSON，例如
  `Array.from(document.querySelectorAll('#pageTabs span.n')).map(e=>e.textContent)`；
  `document.querySelector('style[data-dsh-csmm="true"]') !== null`；
  `document.querySelector('.trust-banner[data-restricted]')?.innerText`。
- 复选框/输入：`dsh_browser_check` / `dsh_browser_set_value` / `dsh_browser_fill`（表单批量），再用 `dsh_browser_get_value` 验证。
- toast：动作后**立刻**读 `#toastHost`，toast 会自动消失：
  `dsh_browser_execute {script:"document.querySelector('#toastHost')?.innerText || ''"}`。
- a11y 里的名称就是点击用的 text：`CSMM`、`保存草稿`、`设为生效`、`保存并设为生效`、`删除分组`、`确认删除`、`信任并加载`、`暂不信任`、`继承下层`、`不使用分组` 等。文本重复时（如 `上下文` 与 `上下文洞察`）先精确匹配，再用 CSS 限定容器。

### 3.4 React 异步 flush 与“点了没反应”

1. **等状态，不等时间**：点击后优先 `dsh_browser_wait {selector:"#toastHost .toast"}` 或 `dsh_browser_assert` 轮询目标状态；不要 `sleep(2000)` 掩盖问题。
2. **点击是否真的落到元素**：`dsh_browser_assert {js:"document.activeElement?.outerHTML.includes('…')"}` 或看 `dsh_browser_doctor`；被遮罩挡住时 `autoDismiss`/先关弹窗。
3. **disabled 要单独判**：`dsh_browser_execute {script:"document.querySelector('#saveBtn').disabled"}`；按钮禁用时点击合法地“无反应”，这本身是断言。
4. **DOM 被替换后重取**：React 重渲染会让旧节点失效；每次交互前重新 `a11y` 或重新用 selector 查询，不复用旧索引。
5. **点击无效三连查**：`dsh_browser_console`（看错误/异常）→ `dsh_browser_network`（看是否发了 `/dsh-csmm/rpc`、状态码）→ `dsh_browser_state`（URL/加载态是否卡住）。若 RPC 已发但 UI 未变，按 RPC 结果与 `snapshot` 为准并记 UI 偏差。
6. **面板加载卡住**：错误块文本 `CSMM 后端未连接：…`；点 `重试`；仍失败则检查 host 路由（§7）。
7. **写入后刷新语义**：保存成功后 `sync()` 会重新拉 bootstrap，**磁盘覆盖本地草稿**（`GRP-06` 的缺陷来源）；涉及“先看本地、再看落库”的用例必须刷新前后各取证一次。

### 3.5 截图

`dsh_browser_screenshot {savePath:"D:\\Temp\\csmm-evidence-<RUN_ID>\\shots\\<CASE-ID>-<step>-<hhmmss>.png", fullPage:false}`。四个固定位：面板首屏、写操作 toast、刷新后状态、上下文面板 before/after。`fullPage:true` 只用于诊断列表/长预览；不要用它代替 a11y 断言。

### 3.6 RPC 取证（curl 会 401）

矩阵 §0 的 `curl` 示例**没有带认证**，在本实例上会得到 401；不要据此判“RPC 不可用”。权威取证方式是在**已登录页面内**发 fetch：

```js
// snapshot
await (await fetch('/dsh-csmm/rpc',{method:'POST',headers:{'content-type':'application/json'},
  body:'{"method":"snapshot"}'})).json()

// dispatch（含 expectedRevision）
await (await fetch('/dsh-csmm/rpc',{method:'POST',headers:{'content-type':'application/json'},
  body: JSON.stringify({method:'dispatch', command:{type:'group.save', scope:{kind:'global',id:null},
    expectedRevision: 10, group:{...}, name:'x'}})})).json()
```

响应形状：`{ok:true, snapshot:{revision, bootstrap:{workspaces,sections,skills,servers,groups,customs,activeGroup,copy}, diagnostics}}`。**数据在 `snapshot.bootstrap`，不是 `snapshot.store`**；`revision` 是全局 doc 的 revision。把响应原样存 `EVDIR/rpc/<CASE-ID>.json`（含 HTTP 状态与时间戳，可加 `{status, body}` 包装）。

## 4. P0 执行脚本（每用例逐步 + 失败判定）

> 每轮开始前：确认 §2.4 基线通过；每次写操作前重读 `snapshot.revision`（记 `R0`）。下表“序列”是 `dsh_browser_*` 的最短步骤，细节断言见清单同编号行。

### 轮次 R0：加载与环境（Fixture G/W 已播种）

| 编号 | 脚本化序列 | 失败判定 |
|---|---|---|
| ENV-01 | `open(tokenURL)` → `a11y` → 查 `CSMM` 名称 | 侧栏无 CSMM → 查 §1.4 四连；BLOCKED/FAIL，整轮停 |
| ENV-02 | `click text=CSMM` → `assert js:!!document.querySelector('.topbar')` → `assert selector=nav[aria-label=作用域]` → 依次 assert 另三栏 | 任一 landmark 缺失/出现错误块 → FAIL |
| ENV-03 | `execute fetch snapshot` → 断言 200/ok/八键/diagnostics 数组 | 非 200 或键缺失 → FAIL（查 host 加载） |
| ENV-08 | 读 `snapshot.revision` | 刚播种应为 10；不是 10 但能解释（此前测试写入/上次运行残留）→ 记录 `R0` 并全程以 `R0` 推算，允许继续；无法解释或刚播种即漂移 → 停并重播种 |
| ENV-09 | `execute` 读 `#pageTabs span.n` 三个值 + `.badge` 两个值 | 非 `6/4/2` 或徽标不符 → 查 `<WS_ID>`/夹具；FAIL |
| SCOPE-01 | `refresh` → 断言全局 `aria-current` + 面包屑 `全局` + `全局 · 提示词 6` | 自动进工作区/有弹窗 → FAIL（数据或信任态不符） |
| SCOPE-02 | `execute` 读工作区按钮 `data-id`/`title`/`rail-sec` 文本 | 无工作区行或 id 为空 → BLOCKED（registry 不可用） |
| UX-01 | `a11y` 检查四个 landmark 与 `role=tablist/tab` | 角色缺失 → FAIL |

### 轮次 R1：只读基线（全局）

| 编号 | 脚本化序列 | 失败判定 |
|---|---|---|
| GRP-01 | 断言 `✓ 基础组`、`≈ 125 tok`、`提示词段 0`、`技能 1`、`MCP 服务器 1`、`生效合计 130 tok`、`工具 deny 1`、`技能遮蔽 3` | 任一数值不符 → 先核对夹具；仍不符 FAIL |
| SUM-01 | 断言 `[aria-label=上下文预算]` 文本 `130 / 200K tok` 与 `budget-bar` aria-label | 数字/文案不符 → FAIL |
| SUM-02 | `execute` 读预算卡图例五项（`上下文 0`/`提示词段 0`/`技能 5`/`MCP 120`/`自定义 5`） | 图例缺项或数值不符 → FAIL |
| SUM-03 | 断言预览各行（技能 alpha、mcp:alpha-mcp、自定义 · 回答风格） | 缺行/多行 → FAIL |
| SUM-04 | `click text=诊断` → 断言 `span.n=3` 与三条文案 | 条数/级别不符 → 查 activeGroup 是否 g-base |
| SKL-01 | `click tab=技能` → `execute` 读 4 行 name/label/dot/tag | 行数或标记不符 → FAIL |
| SKL-04 | `click text=Alpha` → 断言标题/tag/`~/.dsh/skills/alpha/SKILL.md`/`5 KB` | 缺字段 → FAIL |
| SKL-18 | `click [data-skillview=preview]` → 断言 frontmatter 字段 + `技能正文甲` | 文本不含正文 → FAIL |
| SKL-19 | `click [data-skillview=raw]` → 读 `pre[data-skillraw]` 文本 | 与 store 的 text/frontmatter 拼接不一致 → FAIL |
| MCP-01 | `click tab=MCP` → 断言两行 meta（`1/2 工具 · stdio`、`未连接 · http`） | 状态/计数不符 → FAIL |
| MCP-03 | `click text=Alpha MCP` → 断言 `2 个（1 deny）`、`配对段 mcp:alpha-mcp · 120 tok`、`stdio · node` | 缺字段 → FAIL |
| MCP-17 | `click text=查看原文` → 断言 `#fRaw[readonly]` 且含 `serverName: alpha-mcp` → `key Escape` | 可编辑/文本缺 → FAIL；关闭后 rev 变化 → FAIL |

### 轮次 R2：全局写操作（每步后按需恢复夹具）

| 编号 | 脚本化序列 | 失败判定 |
|---|---|---|
| GRP-02 | `click text=+ 新分组` → toast 文本 + 行 `编辑中` | 无 toast 或 rev/disk 变化 → 记缺陷（新建应为纯本地） |
| GRP-03 | `click text=基础组` → `fill #itemName 基础组改` → `click #saveBtn` → 读 toast → 读 rev/store | toast 无 `分组已保存` 或 store 名称未变 → FAIL |
| GRP-05 | `click text=空组` → `click [data-effective]` → toast → `snapshot` activeGroup → 预览 `✓ 空组` | activeGroup 未变/预览未切 → FAIL |
| GRP-15 | `click 基础组` → `check input[data-check=1][data-kind=skill][data-name=beta]` → `click #saveBtn` → 读 store items | 保存后 items 不含 beta → FAIL |
| GRP-19 | `click 空组` → `click 删除分组` → `click 取消` → 断言回到 `删除分组`；再 `click 删除分组` → `click 确认删除` → toast + store | 点一次就删/无取消/取消后仍删除 → FAIL |
| CUS-01 | `click text=+ 新自定义` → 断言 `#saveState=未保存` | 自动落库（rev 变）→ FAIL |
| CUS-02 | `fill #customText 补充说明` → `click #saveBtn` → toast/store | 内容未落库 → FAIL |
| CUS-04 | `click 回答风格` → `check` 行首复选框 → 断言 `已停用` 与 store `enabled=false` | 预览未消失或 store 未变 → FAIL |
| SKL-05 | `click Beta` → `click [data-sktoggle]` → toast/store | store beta 仍 enabled → FAIL |
| SKL-09 | `click Beta` → `click 删除` → `click 确认删除` → store | 组引用未清或定义仍在 → FAIL |
| SKL-12 | 切工作区 → `click Gamma` → `click [data-skillmove=global]` → toast + 全局 store | 全局无 gamma 或工作区 gamma 消失（应为纯复制）→ FAIL |
| MCP-04 | `click Alpha MCP` → `check input[data-tool][data-tool-name=write]` → 读 rev/store | 未发 RPC、rev 不变或 store 未更新 → FAIL |
| MCP-07 | `click [data-mcptest]` → 读 `testMsg` → toast | testMsg 不是 `宿主未提供 MCP 探测接口` 或状态被改成 connected → FAIL |
| MCP-09 | `click + 添加` → `fill` 名称 `input[placeholder="MCP Server"]`=demo、命令 `input[placeholder="npx"]`=npx、参数 `textarea[placeholder*="@modelcontextprotocol/server-github"]`=`-y`、env `textarea[placeholder*="GITHUB_TOKEN"]`=`TOKEN=abc` → `click [data-saveserver]` → 读 store+secrets | env 值进 store、或 secrets 无值 → FAIL（安全边界）；定位失败时改人工填写并截图（ServerForm 没有 id/name/data-*，这些选择器是脆弱的） |
| MCP-10 | `click + 添加` → `click text=HTTP`（“调用方式”行的第二个 `.MCP_transportBtn`）→ `fill input[placeholder="MCP Server"]`=http-demo → `fill input[placeholder="https://example.com/mcp"]`=https://example.com/mcp → `click text=Bearer 令牌` → `fill input[placeholder="eyJ… 或 ${MCP_TOKEN}"]`=tok123 → `click [data-saveserver]` → 读 `headerKeys`/secrets | store 的 `headerKeys` 含 `Authorization`、secrets.headers 有值且不含明文令牌；`env` 未混入 → 否则 FAIL。ServerForm 没有 id/name/data-*，以上选择器依赖 placeholder 与可见文本（脆弱）；定位失败改人工填写并截图 |
| MCP-15 | `click demo`（MCP-09 后）→ `编辑配置` → 密钥留空 → 保存 → 读 secrets | `secrets.env.TOKEN` 被清空或值变成空串 → FAIL |
| MCP-18 | `click 停用` → toast/testMsg/store | 预算仍含 120 或 store enabled 未变 → FAIL |
| MCP-13 | `click 编辑配置` → 名称 `input[placeholder="MCP Server"]` 改 `alpha2` → `click [data-saveserver]` → 等一次读模型刷新 → 读 store 两条记录与组引用 | **v1 预期**：旧 `alpha-mcp` 仍在、`alpha2` 新增、组引用仍 `alpha-mcp`（LIM-17）→ 记 KNOWN-DEFECT；若旧记录被删/引用被改写 → 说明已修复，更新清单/矩阵。**最后跑**；R3 前重新播种恢复 |
| DAT-01 | 读 store.json/secrets.json/snapshot 对比 | store 含明文 env/headers → **FAIL（安全）** |
| DAT-03 | 页面内 fetch dispatch 用 `R0` 保存 → 页面 `click 保存草稿` → 读 toast | 未出现 `revision conflict` → FAIL |
| DAT-11 | 全局写后 `ls` 工作区目录 → 工作区写后 `ls` 其他工作区 | 出现跨域文件变化 → FAIL（I4 类） |
| SKL-22 | 同 SKL-15；`runMigrate` 改为发写命令并 `sync()` 后再执行 | v1 **BLOCKED**（前置不成立）；不得记 PASS/FAIL |
| MCP-23 | 同 MCP-13；`mcp.save` 支持 rename（删旧/改组引用）后再执行 | v1 **BLOCKED**（前置不成立）；不得记 PASS/FAIL |

> ServerForm 没有 `id`/`name`/`data-*`：R2 的 MCP 表单步骤一律用 placeholder/可见文本定位（见 MCP-09），字段文案或占位符一变就会失效；定位失败时改人工填写并截图为证据，不要硬点坐标。

### 轮次 R3：工作区与信任（重新播种 Fixture G/W，清掉 R2 的改动；G 改 `trusted=false`、`revision=20`）

| 编号 | 脚本化序列 | 失败判定 |
|---|---|---|
| SCOPE-03 | `click` 工作区按钮 → 断言面包屑/`2 / 5 / 2`/`Alpha（工作区覆盖）` | 数据不合并或计数不符 → FAIL |
| TRUST-01 | `refresh` → `click` 工作区 → 断言 `#modalTitle=信任此工作区？` + 按钮 | 无弹窗（trusted 未生效为 false）→ 检查夹具后 FAIL |
| TRUST-02 | `click text=暂不信任` → toast + `.trust-banner[data-restricted]` + `0 / 4 / 2` | 横幅缺失或页签仍工作区数据 → FAIL |
| TRUST-03 | `click + 新分组` → `click 保存草稿` → toast | 保存成功（服务端未拒绝）→ **FAIL（信任防线）** |
| TRUST-09 | 页面内 snapshot（scope=workspace） → diagnostics 含 `W_TRUST` | 无 W_TRUST 或返回工作区数据 → FAIL |
| TRUST-04 | `click text=信任并加载`（横幅） → toast + 小 tab + store trusted | 未写全局 store → FAIL |
| TRUST-05 | 重置 trusted=false/rev+1 → `refresh` → `click` 工作区 → `click` 弹窗 `信任并加载` | 弹窗未关/信任未落库 → FAIL |
| TRUST-06 | 切全局→切工作区 → 全局 4 技能不含 Gamma | 作用域数据串台 → FAIL |
| GRP-07 | 工作区 → `click 继承下层` → toast + `snapshot` 无键 | 键仍存在或预览未继承 → FAIL |
| GRP-08 | `click 不使用分组` → toast + `activeGroup[workspace:…]=""` + 预览空 | 值非空串/预览仍显示上层 → FAIL |
| GRP-11 | `click g-ws` → `click 设为生效` → 预览 `被本层覆盖的下层分组 · 1`、`14 tok` | 覆盖提示缺失 → FAIL |
| GRP-12 | 工作区技能页 → 断言单行 `Alpha（工作区覆盖）`、`6 KB`、技能 7 tok | 出现两条 alpha 或字节数错 → FAIL |
| GRP-13 | 工作区 MCP → `click Alpha MCP（工作区）` → 单条 + `7 tok` | 同名两条 → FAIL |
| SKL-07 | 工作区 → `click Beta` → `停用` → 两 store 对比 | 全局 beta 被改/工作区无覆盖 → FAIL |
| SKL-10 | 工作区 → `click Beta` → `删除` → `确认停用` → 两 store | 全局 beta 消失 → FAIL |
| SKL-11 | 工作区 → `click Alpha（工作区覆盖）` → 删除确认 → 两 store | 全局 alpha 消失或 `g-ws` 引用残留 → FAIL |
| SKL-15 | 切全局 → `click Alpha` → `click 复制到…` → `select #migTarget` → `click 执行复制` → 读 toast/rev/store → 切到目标工作区再读 | **v1 预期**：toast `已复制 1 项到 <title>`、rev 不变、目标 store 无 alpha、切作用域后列表无 alpha（LIM-16）→ 记 KNOWN-DEFECT；若目标 store 真出现 alpha → 已修复。全程未发写命令才算符合 v1 |
| DAT-05 | 工作区保存自定义 → 两 store revision | 仅工作区 +1 或全局未 +1 → FAIL |

### 轮次 R4：上下文黑盒（v1 负向）

> 前置：`dsh-context` 已在 profile `web`（本机 0.84.1，`node_modules/dsh-context` 存在，会话头出现 `上下文` 页签）。确认：`ls "$DSH_HOME/profiles/web/node_modules/dsh-context/package.json"`；缺失则 `dsh plugin --profile web add dsh-context` 并重启，再做 §1.4 四连。页签被隐藏时可在 composer 输入 `/context` 打开同一面板；两者都不可用时 R4 全部标 BLOCKED。

> **R4 从夹具基线重新开始（不沿用 R2/R3 残留）**：① 重跑 §2.3 的两条 `sed` 重新播种 Fixture G/W（覆盖此前写入）→ 刷新页面 → 按 §2.4 自检（`revision=10`、`activeGroup["global:"]="g-base"`、页签 `6 / 4 / 2`）；② 若当前在工作区，`click [data-scope=global]`，断言 `[aria-current=true]` 且预览 `✓ 基础组`。未回到全局或基线不符 → R4 全部 BLOCKED，先修环境。

| 编号 | 脚本化序列 | 失败判定 |
|---|---|---|
| CTX-01 | ① 会话页 → `click text=上下文`（精确匹配，避免 `上下文洞察`）→ 读三行 `系统提示词/技能注入/工具定义` 的项数/tok → 截图；② `click text=CSMM` → 断言 `[data-scope=global][aria-current=true]` → `click 空组` → `click [data-effective]`（`设为生效`）→ toast `已保存并设为生效：空组` → snapshot 断言 `activeGroup["global:"]="g-empty"`；③ `click 基础组` → 断言 `[data-effective]` 存在（`设为生效`）→ `click [data-effective]` → toast `已保存并设为生效：基础组` → snapshot 断言 `activeGroup["global:"]="g-base"`；④ 回会话页 → 切走再切回 `上下文` → 读同三行 → 截图 | **v1 负向通过（PASS）**：④ 三行与①一致、无注入内容 → 记 PASS，**不是 KNOWN-DEFECT**；面板出现 `技能正文甲`/`示例服务器说明`/`基础组` → FAIL（v1 不应注入）；三行因无关宿主活动变化 → BLOCKED；②③ 的 `[data-effective]` 不存在 → 前置失败，BLOCKED（`GroupEditor.tsx:245` 只在 `effId!==g.id` 渲染，不能对生效组本身点“设为生效”） |

### 轮次 R5：缺陷复现（最后跑，跑完恢复夹具）

| 编号 | 脚本化序列 | 失败判定 |
|---|---|---|
| GRP-06 | **前置**：`基础组` 当前不能是生效组（夹具基线/R4 结束后 `activeGroup=g-base`，按钮不渲染）。先 `click 空组` → `click [data-effective]`（`设为生效`）→ toast，使 `基础组` 变成非生效组；若 `空组` 已被删则先重新播种 §2.3。然后 `click 基础组` → 断言 `[data-effective]` 出现 → `uncheck alpha-mcp` → 断言按钮变 `保存并设为生效` → `click [data-effective]` → 记录预览 → 读 store → `refresh` → 再看勾选 | 按钮始终不出现 → 前置失败，BLOCKED；若 store 的 `g-base.items` 真被更新且刷新后保留 → 缺陷已修复（需更新清单/矩阵），否则按 KNOWN-DEFECT/LIM-05 记录 |

失败判定通用规则：**先判环境（四连/基线/revision），再判断言**；环境问题记 BLOCKED，不记 FAIL。任何“UI 说成功但磁盘没变”都按 FAIL 或 KNOWN-DEFECT 记录，并附 store 证据，绝不写成 PASS。

## 5. 证据与报告

### 5.1 目录与命名

```
EVDIR/
  run.log              启动日志（含 token 行；token 视为凭据，不贴报告正文）
  env.txt              dsh --version、profile package.json bundles 片段、DSH_HOME、WS_ID、commit
  backup/              测试前 global-csmm/、workspace-dsh/（原样）
  shots/<CASE-ID>-<step>-<hhmmss>.png
  rpc/<CASE-ID>.json   {at, status, body}
  disk/<CASE-ID>-global.json / -workspace.json / -secrets.keys.txt
  report.md            最终报告
```

- 每个 P0 用例至少一份证据：断言类=RPC/DOM 文本，写操作类=store 快照+toast，视觉类=截图。
- `secrets.json` 只记录**键名与来源**，不复制明文；如需证明“值仍在”，记录 sha256 前 8 位。
- 截图用 `savePath` 绝对路径，禁止覆盖同名文件；报告里引用相对 `EVDIR` 的路径。
- 时间统一用本机本地时间并在报告首行注明时区。

### 5.2 报告模板

```md
# dsh-csmm 浏览器测试报告 <RUN_ID>
环境：dsh 0.2.2-rc.2 / profile web / 3080 / 插件 dsh-csmm@0.1.0 / 源码 <commit>
数据：Fixture G rev10 + Fixture W rev4（WS_ID=…）；备份在 backup/
浏览器：dsh_browser_*（内置，非 MCP）

| 编号 | 状态 | 预期 vs 实际 | 证据 |
|---|---|---|---|
| ENV-02 | PASS | 四栏齐全 | shots/ENV-02-…png, rpc/ENV-02.json |
| GRP-06 | KNOWN-DEFECT(LIM-05) | 预览立即变化；store 仍含 alpha-mcp；刷新丢失 | disk/GRP-06-*.json |
…

统计：PASS n / KNOWN-DEFECT n / FAIL n / BLOCKED n / SKIP n
结论：<可发布/需修复/环境阻塞>；未覆盖项见 §7。
```

### 5.3 失败升级

- P0 FAIL：停止后续轮次（避免在污染数据上继续），保留现场，按 §6 还原后重跑一次确认；仍失败则报告阻塞。
- 数据层 FAIL（DAT-01 secrets 落 store、DAT-11 跨域写）：无论优先级，先停并上报，不在现场“清理”掉证据。
- 断言与矩阵冲突：以源码+实测为准，同时更新清单/矩阵对应行（两者同一提交），避免口径漂移。

## 6. 清理与还原

```bash
# 1) 停实例（只杀本测试实例）
PID=$(netstat -ano | grep ':3080' | grep LISTENING | awk '{print $NF}' | head -1)
powershell -NoProfile -Command "Stop-Process -Id $PID"
sleep 2; netstat -ano | grep ':3080' | grep LISTENING || echo "port free"

# 2) 还原 CSMM 数据（有备份则恢复；原本不存在则删掉测试创建目录）
if [ -d "$EVDIR/backup/global-csmm" ]; then
  rm -rf "$DSH_HOME/dsh-csmm" && cp -a "$EVDIR/backup/global-csmm" "$DSH_HOME/dsh-csmm"
else
  rm -rf "$DSH_HOME/dsh-csmm"
fi
if [ -d "$EVDIR/backup/workspace-dsh" ]; then
  rm -rf "$WSROOT/.dsh" && cp -a "$EVDIR/backup/workspace-dsh" "$WSROOT/.dsh"
else
  rm -rf "$WSROOT/.dsh"
fi

# 3) 临时工作区（若用过）与残留
rm -rf /d/Temp/csmm-ws
ls "$DSH_HOME/dsh-csmm" 2>/dev/null || echo "no global csmm dir"
find "$DSH_HOME/dsh-csmm" "$WSROOT/.dsh" \( -name '*.tmp' -o -name 'store.lock' \) 2>/dev/null

# 4) 保留证据与审计产物；确认仓库只有预期改动
cd /e/Code/_dev_skill_mcp/dsh-csmm && git status --short
```

> 语法自检：本块用 `\(`（单个反斜杠），不要写成 `\\(`；2026-11-22 已用 `bash -n` 校验（exit 0）。在 PowerShell 里运行请走 Git Bash，避免二次转义。

- **不要删除**：`$DSH_HOME/storages/workspace.json`、`$DSH_HOME/sessions/`、其他工作区目录、`EVDIR/`。
- 插件默认保留在 profile `web`（下次测试直接用）；若任务要求卸载，按 §1.2 的卸载路径执行并记录。
- 若把 `.dsh/` 写进了仓库，确认 `.gitignore` 已含 `.dsh/` 且 `git status` 不显示它；不要 `git add -f`。

## 7. 已知不可测 / 诚实边界

| 编号 | 现状 | 报告写法 |
|---|---|---|
| LIM-01 | 宿主恒传 `sections: []`（`src/host/index.ts:96`） | 提示词段相关断言只能证明“空即不计入”；`CTX-01` 三行不变即记 **PASS（负向通过），不是 KNOWN-DEFECT**；`GRP-18/SUM-13` 记 KNOWN-DEFECT；不得声称 section 端到端可用 |
| LIM-02 | 未注入 MCP `probe` | `MCP-07` 断言诚实错误 `宿主未提供 MCP 探测接口`；不得伪造 connected/工具清单 |
| LIM-03 | 全局页不展示工作区资源 | 同名覆盖只断言“单条记录 + 覆盖文案” |
| LIM-04 | `trustDeclined` 仅 UI 内存 | 拒绝态刷新即失效；不得测“重启后仍拒绝” |
| LIM-05 | `保存并设为生效` 不保存脏 items（`navigation.ts:20-43`） | `GRP-06` 记 KNOWN-DEFECT，并给出“先保存草稿再设为生效”的规避 |
| LIM-06 | 工作区写双写工作区+全局（记帐 revision） | 断言两个 revision 都 +1，不误判跨域违规 |
| LIM-07 | 删除 undo 仅本地 | “撤销后持久化”不可测；测本地恢复 + 刷新消失 |
| LIM-08 | 加入分组/资源面板无草稿时仅本地 | 刷新即丢；不得写成已持久化 |
| LIM-09 | 全局“复制到当前工作区”取 `meta.workspaces[0]` | 固定单工作区执行；多工作区时标 BLOCKED |
| LIM-10 | 技能导入只改本地、目录上传难驱动 | 只测 `.md` 上传本地效果 + 刷新丢失；目录上传标 SKIP(人工) |
| LIM-11 | 剪贴板依赖权限 | 只断言 toast；不把剪贴板内容当唯一证据 |
| LIM-12 | 无 viewport/媒体特性接口 | 响应式标 P2 人工；不得声称自动化验证 |
| LIM-13 | `npm test` 不含 UI/viewmodel | 浏览器矩阵是 UI 唯一证据；不得用单测通过代替 |
| LIM-14 | 未注册工作区 → 无绑定 | 先确认作用域栏 `<WS_ID>`；否则写操作全部 `E_APPLY` |
| LIM-15 | 信任在 store `workspaces[].trusted`，非 `trust.json` | 不要按旧 SPEC 找 `trust.json` |
| LIM-16 | 技能迁移 `runMigrate` 只改本地 state，不发 RPC（`src/UI/viewmodel/actions/modals.ts:17-40`） | `SKL-15` 记 KNOWN-DEFECT；不要断言“刷新后磁盘有副本”；后续契约见 `SKL-22` |
| LIM-17 | MCP 重命名只本地改组引用且只发 `mcp.save`；host 按新名 upsert、不删旧、不改组引用（`modals.ts:105-125`、`src/host/service.ts:179-197`） | `MCP-13` 记 KNOWN-DEFECT（磁盘出现新旧两条）；后续契约见 `MCP-23` |

补充不可测项：

1. **插件未安装时的路由**：安装后无法“回到未安装”再测 405/404，除非临时把 `"dsh-csmm"` 从 `dsh.profile.bundles` 移除并重启。若确需覆盖：备份 package.json → 移除 bundle 行 → 重启 → `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3080/dsh-csmm/rpc`（期望 405，`allow: GET, HEAD`）与 `GET /dsh-csmm/rpc`（期望 404）→ 恢复并重启。默认轮次不做，报告标“未覆盖”。
2. **浏览器 MCP 路径**：本机未装（§1.5），其配置/兼容性未验证；不得写“已验证”。
3. **加载态/错误态**：加载太快，通常只能靠断点/慢网观察；错误态需停 host 或改路由，属人工构造，标 P1/SKIP。
4. **真实 OAuth / 真实 MCP 连接 / 真实技能文件导入宿主**：当前实现只有状态位或本地解析，没有宿主副作用；按断言写，不按产品宣传写。
5. **认证 token**：旧 token 不可恢复；报告只记“已从本次启动日志取得”，不要贴 token 明文。
