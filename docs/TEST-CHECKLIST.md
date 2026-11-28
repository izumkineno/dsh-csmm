# dsh-csmm 浏览器测试清单（t3）

> 本文件是 `t3` 交付物之一：把 `docs/BROWSER-TEST-MATRIX.md`（t2，128 条）收敛成**可执行、可判定、可取证**的用例清单。执行机制（启动、播种、浏览器调用、证据、清理）见 `docs/BROWSER-TEST-SOP.md`（下称 SOP）。
>
> 编号规则：沿用 t2 矩阵的用例编号（`ENV-xx`、`SCOPE-xx`、`TRUST-xx`、`GRP-xx`、`CUS-xx`、`SKL-xx`、`MCP-xx`、`SUM-xx`、`DAT-xx`、`UX-xx`），便于与矩阵逐条对照。新增 `CTX-01/CTX-02` 是本轮追加的“上下文面板黑盒”用例（用户要求），矩阵中没有对应行。
>
> 如实边界：本清单的 UI 选择器与期望值来自 `src/**` 源码与 2026-11-22 的实机加载（插件装到 profile `web`、面板成功挂载、`snapshot` 返回 200）。**除安装与加载外，其余用例本轮没有逐条执行**；第一次按本清单执行的人就是首个完整执行者，请在报告里注明。

## 0. 怎么用这份清单

1. 先按 SOP §1 起实例、装插件、验证四连；再按 SOP §2 播种夹具并自检基线。
2. 跑 **§3 P0**：顺序与矩阵 §5 冒烟集一致；矩阵 27 条冒烟约 30–40 分钟，§3 全量 61 条 P0（含 CTX-01）约 60–90 分钟；§3.10 另有 2 条 BLOCKED 后续断言，不计入 P0 统计。P0 全部通过（或偏差被记录为已知缺陷）才进入 P1。
3. P0/P1 的偏差写入报告（SOP §5），不要现场“修数据让它过”。
4. 每条用例的证据写入 `EVDIR/<用例编号>/`（见 §2.3）。

**状态取值**（报告里只允许这五种）：

| 状态 | 含义 | 判定 |
|---|---|---|
| PASS | 实际观察与「预期」逐项一致 | 证据齐全 |
| KNOWN-DEFECT | 实际行为与「预期」不一致，但差异已在「已知限制」列或 SOP §7 登记 | 记录 LIM 编号 + 实际值 |
| FAIL | 实际与预期不一致，且不是已知限制 | 必须附证据并标 P0/P1 |
| BLOCKED | 前置不满足（缺环境/缺数据/需人工授权），无法执行 | 写明缺什么，不得写成 PASS |
| SKIP | 主动不跑（如需停 host 的错误态） | 写明理由 |

## 1. 前置与共同环境（每条用例不再重复）

| 项 | 要求 |
|---|---|
| 宿主 | DSH 0.2.2-rc.2，`dsh --profile web --no-open`，默认 `http://127.0.0.1:3080/` |
| 插件 | 本仓 `dsh-csmm@0.1.0` 已装进 profile `web`，`dsh.profile.bundles` 含 `"dsh-csmm"`，实例已重启 |
| 登录 | 打开启动日志里的 `?token=...` 认证 URL（裸 3080 返回 401） |
| 数据 | 全局 store = Fixture G（revision 10），工作区 store = Fixture W（revision 4，`<WS_ID>` 取 UI 实际值）；基线断言见 SOP §2.4 |
| 浏览器 | `dsh_browser_*`，同一任务会话；CSMM 面板已从左侧栏 `CSMM` 打开 |
| 证据根 | `EVDIR=D:\Temp\csmm-evidence-<run-id>`，命名见 SOP §5 |

## 2. 记号与判定口径

### 2.1 断言记号

| 记号 | 取证方式 |
|---|---|
| `[DOM]` | `dsh_browser_a11y` / `dsh_browser_assert` / `dsh_browser_find`，必要时 `dsh_browser_evaluate` 读属性 |
| `[TOAST]` | `#toastHost .toast` 文本；toast 会自动消失，点击后**立刻**读 |
| `[RPC]` | 页面内 `fetch('/dsh-csmm/rpc', …)`（同源、带 cookie），**不要用未认证的 curl**（见 SOP §3.6） |
| `[DISK]` | 读 `$DSH_HOME/dsh-csmm/store.json`、`secrets.json`、`<WSROOT>/.dsh/<WS_ID>/store.json` |
| `[REV]` | 每次操作前重新读 `snapshot.revision`（`R0`），不沿用上一步；**revision 是全局 store 的**，工作区写也会 +1 |
| `[SHOT]` | `dsh_browser_screenshot`，保存到 `EVDIR/<ID>/` |

### 2.2 数据夹具（完整 JSON 见 SOP §2.3）

- **Fixture G**（全局，revision 10）：4 组（`g-base`/`g-empty`/`g-missing`/`g-off`）、2 自定义、4 技能、2 MCP；基线页签 `6 / 4 / 2`，默认生效 `g-base`，预览 `≈125 tok`、合计 `130 tok`。
- **Fixture W**（工作区，revision 4）：`g-ws`、`c-ws`、`alpha` 覆盖、`gamma`、`alpha-mcp` 覆盖；工作区页签 `2 / 5 / 2`。
- `g-base.items = [skill alpha, mcp alpha-mcp]`；`g-ws.items = [skill alpha]`。
- 基线自检必须通过（SOP §2.4），否则本轮所有计数类断言作废。

### 2.3 证据目录

```
EVDIR/<用例编号>/
  01-before.png     操作前截图（需要视觉对比时）
  02-after.png      操作后截图
  snapshot.json     关键 RPC 响应（含 revision）
  store-global.json 关键磁盘快照（拷贝，不是原始路径链接）
  notes.md          实际值、偏差、时间戳
```

## 3. P0 用例（必跑）

> 顺序即建议执行顺序。凡涉及 fixture 修改的用例，跑完必须恢复 Fixture G/W 再继续。

### 3.1 安装与加载

| 编号 | 场景 | 前置 | 步骤 | 预期 | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| ENV-01 | 侧栏 CSMM 入口 | 插件已装、实例已重启、已认证打开 GUI | a11y 找 `CSMM` → 不点击，记录位置 | `[DOM]` 侧栏出现 `CSMM` 按钮（`sidebar.panellist`，id `dsh-csmm`） | 截图 `01-before.png` | `src/client/index.tsx`（registerPanel，119-140） |
| ENV-02 | 主面板四栏 | ENV-01 | 点击 `CSMM` → 等待主区出现 | `[DOM]` `.topbar` 文本含 `系统提示词`；`nav[aria-label=作用域]`、`nav[aria-label=列表]`、`main[aria-label=编辑]`、`aside[aria-label=生效预览]` 均存在；`#pageTabs` 存在 | 截图 + `a11y` 输出 | `src/UI/view/App.tsx` |
| ENV-03 | RPC snapshot 形状 | 面板已加载 | 页面内 `fetch` POST `{method:'snapshot'}` | `[RPC]` 200，`ok:true`；`snapshot.revision` 为数字；`snapshot.bootstrap` 含 `workspaces/sections/skills/servers/groups/customs/activeGroup/copy` 八个键；`snapshot.diagnostics` 是数组 | `snapshot.json` | `src/host/http.ts:15-45`、`src/host/service.ts:60-66` |
| ENV-08 | revision 基线 | Fixture G 已播种 | 页面内 snapshot | `[RPC] snapshot.revision`：刚播种应为 `10`；若不是 10 但能解释（此前测试写入/上次运行残留）→ 记录实际值 `R0` 并全程以 `R0` 推算，**允许继续**；无法解释或刚播种即漂移 → 停：数据被污染，重播种。**禁止硬编码 10** | `snapshot.json` | `src/host/store.ts`（revision 语义） |
| ENV-09 | 页签计数与作用域徽标 | Fixture G + W，默认全局 | 读 `#pageTabs` 三个 `span.n`；读全局按钮徽标 | `[DOM]` 提示词/技能/MCP 页签计数 `6 / 4 / 2`；全局按钮 `.badge` = `6`；工作区按钮 `.badge` = `2`（工作区徽标按本层组+自定义计） | 截图 | `src/UI/view/components/PageTabs.tsx`、`ScopeRail.tsx` |

### 3.2 作用域与信任

| 编号 | 场景 | 前置 | 步骤 | 预期 | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| SCOPE-01 | 默认全局作用域 | Fixture G | 刷新页面，观察作用域栏与面包屑 | `[DOM]` 全局按钮 `aria-current=true`；面包屑 `全局`；TopBar hint 为 `copy.scopeHint` 文案；无信任弹窗；`[DOM]` 列表头出现 `全局 · 提示词 6` | 截图 | `src/UI/view/components/ScopeRail.tsx`、`App.tsx` |
| SCOPE-02 | 工作区行信息 | 宿主 registry 有工作区 | 看作用域栏 | `[DOM]` `div.rail-sec` 文本 `工作区 N`（N 以实际为准）；仓库按钮 `data-scope=workspace`、`data-id=<WS_ID>`、`title=<path>`；当前工作区带 `.tag.tag-current` `当前` | 截图 + `data-id` 值 | `ScopeRail.tsx`、`src/host/index.ts:68-94` |
| SCOPE-03 | 切到已信任工作区 | Fixture G `trusted=true`，Fixture W 存在 | 点击仓库工作区按钮（`data-id=23848871-523a-4385-a2e3-561ead7e1904`，以实际为准） | `[DOM]` 面包屑 `工作区 · <title>`；页签 `2 / 5 / 2`；技能列表出现 `Alpha（工作区覆盖）`、`Gamma`；`[RPC]` 切作用域请求带 `workspaceRoot`，返回工作区数据 | 截图 + `snapshot.json` | `ScopeRail.tsx`、`src/UI/viewmodel/useAppViewModel.tsx:45-66` |
| TRUST-01 | 首次打开未信任工作区弹窗 | 改 Fixture G：`workspaces[0].trusted=false`、`revision=20`，保留 Fixture W | 刷新 → 点工作区 | `[DOM]` `#modalTitle` = `信任此工作区？`；正文含 `首次打开这个工作区…`；显示工作区 title 与路径；按钮 `暂不信任`、`信任并加载`；左栏 tag `未信任` | 截图 | `src/UI/view/components/Modals.tsx`（TrustPrompt） |
| TRUST-02 | 暂不信任进入受限 | TRUST-01 的弹窗打开 | 点 `暂不信任` | `[TOAST]` `已保持受限访问（可随时在左栏重新信任）`；`[DOM]` 横幅 `div.note.trust-banner[data-restricted]` 含 `受限模式`；页签 `0 / 4 / 2`；tag `未信任` | 截图 + toast 文本 | `src/UI/viewmodel/actions/*`（trustDeclined，内存态） |
| TRUST-03 | 拒绝后写入被服务端拒绝 | TRUST-02 状态 | 点 `+ 新分组` → 点 `保存草稿` | `[TOAST]` `保存失败：workspace is not trusted`；`[REV]` 不变；`[DISK]` 工作区 store 未创建/未修改 | toast + snapshot + `ls` | `src/host/service.ts:94-102`（E_TRUST） |
| TRUST-04 | 横幅重新信任 | TRUST-02 状态 | 点横幅 `信任并加载` | `[TOAST]` `已信任工作区 <title>`；横幅消失；页签 `2 / 5 / 2`；`[RPC]` `workspaces[].trusted=true`、`revision=R0+1`；`[DISK]` 全局 store 已写 | snapshot + store 拷贝 | `src/host/service.ts`（trust.set） |
| TRUST-05 | 弹窗接受信任 | TRUST-01 的弹窗打开（恢复 trusted=false 后重跑） | 点弹窗 `信任并加载` | 同 TRUST-04；弹窗关闭且不再出现 | 截图 | `Modals.tsx`、`service.ts` |
| TRUST-06 | 信任后数据可见且隔离 | TRUST-05 后 | 切全局 → 再切工作区 | `[DOM]` 全局页签 `6 / 4 / 2`，工作区 `2 / 5 / 2`；全局技能列表**不含** `Gamma`；工作区技能页签计数 `5` | 截图 ×2 | `src/UI/model/selectors.ts`（LIM-03） |
| TRUST-09 | 不信任时快照诊断 | TRUST-02 状态 | 页面内 snapshot，`scope={kind:'workspace',id:'<WS_ID>'}` | `[RPC] diagnostics` 含 `{code:"W_TRUST",severity:"warning",message:"workspace is restricted until trusted"}`；`skills` 只剩全局 4 个 | `snapshot.json` | `src/host/service.ts`（diagnostics） |

### 3.3 分组编辑与生效

| 编号 | 场景 | 前置 | 步骤 | 预期 | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| GRP-01 | 默认生效分组预览 | Fixture G，全局 | 看右栏 `生效内容` | `[DOM]` 链节点 `全局` 高亮；`✓ 基础组`；`≈ 125 tok`；`提示词段 0` + `没有选入提示词段。`；`技能 1`；`MCP 服务器 1`；`自定义 · 回答风格`；`生效合计 130 tok`；`工具 deny 1`；`技能遮蔽 3` | 截图 + 文本抽取 | `src/UI/view/components/Preview.tsx` |
| GRP-02 | 新建分组（本地草稿） | 全局 | 点 `+ 新分组` | `[DOM]` 列表出现 `分组 N` 且选中进入编辑器；`[TOAST]` `已创建分组（尚未生效，可编辑后设为生效）`；行内 `编辑中`；`[REV]` 不变；`[DISK]` 不变 | toast + snapshot + store 对比 | `src/UI/viewmodel/actions/library.ts:11-18` |
| GRP-03 | 保存草稿 | 选中 `基础组` | 改名 `基础组改` → 点 `#saveBtn` | `[DOM]` 保存后 `#saveBtn` disabled；`[TOAST]` `分组已保存`；`[RPC] revision=R0+1`；`[DISK]` `groups[id=g-base].name` 变更；页签提示词计数不变 | toast + snapshot + store | `library.ts:59-79`、`src/host/service.ts`（group.save） |
| GRP-05 | 设为生效（无脏改动） | 选中 `空组` | 点 `[data-effective]`（文案 `设为生效`） | `[DOM]` 状态 chip `生效中`；`[TOAST]` `已保存并设为生效：空组` + `撤销`；`[RPC] activeGroup["global:"]="g-empty"`；`[REV] R0+1`；预览 `✓ 空组`；诊断 `生效分组是空组` | toast + snapshot + store | `src/UI/viewmodel/actions/navigation.ts:20-43` |
| GRP-06 | 脏草稿“保存并设为生效”缺陷 | 选中 `基础组`，且它**不是生效组**（顺序执行时依赖 GRP-05 已让 `空组` 生效；单独执行时先重新播种夹具 → `click 空组` → `click [data-effective]`（`设为生效`）→ toast；否则 `[data-effective]` 不渲染，见 `GroupEditor.tsx:245`） | 取消勾选 `alpha-mcp`（只改 draft，不保存）→ 点 `[data-effective]`（文案 `保存并设为生效`） | **预期（当前 v1）**：点击瞬间预览短暂只显示 `alpha`（仅内存），随即 `sync()` 回读磁盘又恢复含 `alpha-mcp`；`[TOAST]` 同 GRP-05；`[REV] R0+1`；`[DISK] g-base.items` **仍是旧值（含 alpha-mcp）**；刷新后取消勾选丢失 → 记 KNOWN-DEFECT / LIM-05。若 `[data-effective]` 不存在 → 前置未满足，记 BLOCKED，不要记 FAIL | toast + store 前后对比 + 刷新后截图 | `navigation.ts:20-43`、`GroupEditor.tsx:245` |
| GRP-07 | 工作区继承下层 | 工作区 A 已信任且 `activeGroup` 无该键 | 点 `继承下层` | `[TOAST]` `已恢复继承（沿用下层分组）`；`[DOM]` 预览 `当前作用域没有自己的生效分组，沿用 全局 的「基础组」。`；`[RPC]` 工作区 `activeGroup` 无该键；`[DISK]` 工作区 store 已写且全局 revision 也 +1 | toast + 两个 store 拷贝 | `navigation.ts`（inheritGroup）、`service.ts:94-102` |
| GRP-08 | 显式不使用分组 | 工作区 A，当前继承全局 | 点 `不使用分组` | `[TOAST]` `本层已声明不使用分组（阻断继承）`；`[RPC] activeGroup["workspace:<WS_ID>"]=""`；预览空态 `当前作用域链上还没有生效分组。左侧启用一个分组，或在编辑器里添加资源。`；预算 0（显式 none 时上层自定义也不进入） | toast + snapshot | `navigation.ts`（setNone）、`service.ts`（winningLayer） |
| GRP-11 | 下层分组被覆盖提示 | 工作区 A 设 `g-ws` 生效 | 选 `g-ws` → `设为生效` | `[DOM]` 预览 `被本层覆盖的下层分组 · 1`，行 `全局` / `基础组 · 2 项被覆盖`；链节点 `工作区` 高亮；预算 `14 tok` | 截图 | `Preview.tsx` |
| GRP-12 | 同名技能覆盖 | 工作区 A | 切工作区 → 看技能列表与预算 | `[DOM]` 只有一行 `Alpha（工作区覆盖） / alpha`，`6 KB`；预览技能 meta 为工作区文案；预算技能按 7 tok 计 | 截图 | `selectors.ts`、`SkillPane.tsx` |
| GRP-13 | 同名 MCP 覆盖 | 工作区 A | 切工作区 → 选 `alpha-mcp` | `[DOM]` 列表只有 1 行 `Alpha MCP（工作区）`；McpPane 标签含 `工作区定义`/`本层覆盖`；`[RPC]` 快照 `servers` 同名仅 1 条；预算 7 tok | 截图 + snapshot | `selectors.ts`、`McpPane.tsx` |
| GRP-15 | 白名单勾选与保存 | 选中 `基础组` | 勾选 `Beta` 技能 → `保存草稿` | `[DOM]` `#sumSkill` 由 1 变 2；`[TOAST]` `分组已保存`；`[DISK]` `g-base.items` 含 `beta`；预览若生效则多一行技能 | toast + store | `GroupEditor.tsx`、`library.ts:59-79` |
| GRP-19 | 两步删除分组 | 选中 `空组` | 点 `删除分组` → 点 `取消` → 再点 `删除分组` → 点 `确认删除` | `[DOM]` 点 `删除分组` 后出现 `确认删除` 与 `取消`（**无定时器，不会自动恢复**）；点 `取消` 回到 `删除分组` 且分组仍在；再次进入确认才执行删除，行消失、编辑器空；`[TOAST]` `已删除分组` + `撤销`；`[DISK]` 分组消失；若删的是生效组，`[RPC] activeGroup` 键被删 | 截图 + store | `GroupEditor.tsx:250-253`、`library.ts:125-160` |

### 3.4 自定义提示词

| 编号 | 场景 | 前置 | 步骤 | 预期 | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| CUS-01 | 新建自定义 | 全局 | 点 `+ 新自定义` | `[DOM]` 列表出现 `自定义 N` 并选中；编辑器标题 `自定义 N`；`#saveState` `未保存`；`[REV]` 不变 | 截图 | `ItemList.tsx`、`library.ts` |
| CUS-02 | 保存自定义 | CUS-01 后 | `#customText` 输入 `补充说明` → 点 `#saveBtn` | `[TOAST]` `已保存`；`#saveState` `已保存`；`#charCount` 显示字数与 token；`[REV] +1`；`[DISK]` customs 新增且 `scope.kind=global`；预览自定义数 +1、预算增加 | toast + store | `CustomEditor.tsx`、`library.ts`（custom.save） |
| CUS-04 | 逐条停用/启用 | 选中 `回答风格` | 点行首复选框 | `[DOM]` `aria-label` 在 `停用/启用自定义提示词 回答风格` 间切换；行出现 `已停用`；预览该条消失、预算减 5；`[REV] +1`；`[DISK] enabled=false` | 截图 + store | `ItemList.tsx:55-77`、`library.ts`（custom.toggle） |

### 3.5 技能

| 编号 | 场景 | 前置 | 步骤 | 预期 | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| SKL-01 | 技能列表与标记 | Fixture G，全局技能页 | 看技能页 | `[DOM]` 4 行：`Alpha / alpha`、`Beta / beta`、`Off Skill / off-skill`（dot off、`已停用`）、`Plug Skill / plug-skill` + tag `插件`；每行有 scope tag `全局` | 截图 | `ItemList.tsx:83-140` |
| SKL-04 | 选择技能打开面板 | 全局技能页 | 点 `Alpha` 行 | `[DOM]` 标题 `Alpha`；tag `全局定义`；meta 含位置 `~/.dsh/skills/alpha/SKILL.md`、`5 KB`、`启用`、调用策略 | 截图 + a11y | `SkillPane.tsx` |
| SKL-05 | 全局启停 | 选中 `Beta` | 点 `[data-sktoggle]`（`停用`） | `[TOAST]` `已停用 beta（全局）`；行 dot off；`[REV] +1`；`[DISK]` beta `enabled=false`；预览/预算不含它（若在组内） | toast + store | `SkillPane.tsx`、`service.ts`（skill.save） |
| SKL-07 | 工作区 copy-on-write 停用 | 切工作区 A，选中全局技能 `Beta` | 点 `停用` | `[TOAST]` `已停用 beta（当前工作区）`；`[DISK]` 工作区 store 新增 beta 覆盖且 `enabled=false`；全局 `beta` 不变但全局 revision +1；面板 tag `本层覆盖`/`已停用` | 两个 store 拷贝 | `service.ts`（skill.save 走 upsert） |
| SKL-09 | 删除全局定义 | 全局选中 `Beta` | `删除` → `确认删除` | `[TOAST]` `已删除 beta（全局定义）`；`[DISK]` 全局 skills 无 beta；引用它的 group items 被清除；`撤销` 仅本地恢复（LIM-07） | toast + store | `SkillPane.tsx`、`library.ts`（removeGroupRefs） |
| SKL-10 | 工作区删除=本层停用 | 工作区 A 选中 `Beta`（无本地覆盖） | `删除` → `确认停用` | `[TOAST]` `已在本工作区停用 beta（全局定义仍保留）`；`[DISK]` 工作区 store 新增 `enabled=false` 覆盖；全局 beta 仍在 | toast + 两个 store | `SkillPane.tsx`、`service.ts` |
| SKL-11 | 删除工作区覆盖 | 工作区 A 选中 `Alpha（工作区覆盖）` | 删除并确认 | `[TOAST]` `已删除 alpha（当前工作区覆盖）`；`[DISK]` 工作区 alpha 消失、`g-ws` 引用清除；全局 alpha 恢复可见 | toast + store | `service.ts`、`library.ts` |
| SKL-12 | 复制到全局 | 工作区 A 选中 `Gamma` | 点 `[data-skillmove=global]` `复制到全局` | `[TOAST]` `已复制到全局：gamma`；`[DISK]` 全局 skills 新增 gamma（scope global、无 wsId）；工作区 gamma 保留；`[REV] +1` | toast + store | `SkillPane.tsx`、`service.ts`（skill.copy） |
| SKL-15 | 迁移执行（v1 仅本地） | 全局选中 `Alpha`，目标工作区 A | 点 `[data-sktool=migrate]` → 选目标 → 勾选技能 → `执行复制` | **预期（当前 v1）**：`[TOAST]` `已复制 1 项到 <title>`，弹窗关闭、选择清空；`[RPC]` **未发任何写命令**、`revision` 不变；`[DISK]` 工作区 skills **不含** alpha；切到目标工作区（触发宿主读模型）或刷新后列表无副本 → 记 KNOWN-DEFECT / LIM-16。后续契约见 SKL-22 | toast + snapshot + 两个 store | `src/UI/viewmodel/actions/modals.ts:17-40`（`runMigrate`）、`Modals.tsx`（Migrate） |
| SKL-18 | SKILL.md 预览 | 选中 `Alpha` | 点 `[data-skillview=preview]` | `[DOM]` 预览区出现 frontmatter（`name:`/`description:`/`invocation:` + `# Alpha`）与正文 `技能正文甲`；`aria-selected=true`；`[REV]` 不变 | 截图 | `SkillPane.tsx` |
| SKL-19 | SKILL.md 原文精确 | 选中 `Alpha` | 点 `[data-skillview=raw]` | `[DOM]` `pre.md-raw[data-skillraw]` 文本 = `skillFile()` 拼接结果（含 frontmatter）；只读、无保存按钮 | 文本抽取 | `SkillPane.tsx`、`src/shared/*`（skillFile） |

### 3.6 MCP

| 编号 | 场景 | 前置 | 步骤 | 预期 | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| MCP-01 | MCP 列表 | Fixture G，全局 MCP 页 | 看 MCP 页 | `[DOM]` `Alpha MCP`：meta `1/2 工具 · stdio`、dot on；`Off MCP`：`未连接 · http`、dot off；scope tag `全局` | 截图 | `ItemList.tsx:142-177` |
| MCP-03 | 选择服务器打开面板 | 选中 `Alpha MCP` | 观察编辑器 | `[DOM]` 标题 `Alpha MCP`；tag `全局定义`；chip `connected`；meta `2 个（1 deny）`、`配对段 mcp:alpha-mcp · 120 tok`、`stdio · node`；说明 `示例服务器说明` | 截图 + a11y | `McpPane.tsx` |
| MCP-04 | 工具开关即时生效 | MCP-03 | 点 `write` 复选框 | `[DOM]` 勾选翻转、meta 变 `启用`；`[RPC]` 已发 `mcp.tools`，`tools[write].on=true`；`[REV] +1`；`[DISK]` 更新；预览 `工具 deny` 计数变化 | toast/network + store | `McpPane.tsx`、`service.ts`（mcp.tools） |
| MCP-07 | 测试连接（无探测接口） | 生产宿主（未注入 probe） | 点 `[data-mcptest]` `测试连接` | `[DOM]` 按钮短暂 `测试中…`；`testMsg` = `宿主未提供 MCP 探测接口`；`[TOAST]` `未接入 MCP 探测`；状态仍 `connected`（fixture 值）；`[REV]` 不变；**不得伪造 connected/工具** | 截图 + toast 文本 | `src/host/http.ts:33-45`（LIM-02） |
| MCP-09 | 添加 stdio 服务器 | 全局 | `+ 添加` → 名称 `demo`、命令 `npx`、参数 `-y`、env `TOKEN=abc` → 保存 | `[TOAST]` `已添加 demo，点「测试连接」拉工具清单`；`[REV] +1`；`[DISK]` store 有 demo（`envKeys:["TOKEN"]`，无 env 值）；`secrets.json` 有 `env.TOKEN=abc`；`[RPC]` snapshot 的 demo 无 `env` 字段 | store + secrets + snapshot | `ServerForm.tsx`、`service.ts`（mcp.save） |
| MCP-10 | 添加 HTTP + Bearer | 全局 | 添加：HTTP、`https://example.com/mcp`、Bearer、令牌 `tok-1` → 保存 | `[DISK]` store `headerKeys:["Authorization"]`；`secrets.json` headers 含 `Bearer tok-1`；`[RPC]` snapshot 无 headers 值 | store + secrets + snapshot | `ServerForm.tsx`、`service.ts` |
| MCP-13 | 编辑并重命名（v1 只发 mcp.save） | 选中 `alpha-mcp` | `编辑配置` → 名称改 `alpha2` → 保存 | **预期（当前 v1）**：`[TOAST]` `已保存 alpha2`；`[RPC]` 只发 `mcp.save`（新名），`revision +1`；`[DISK]` 出现**两条**：旧 `alpha-mcp` 原样保留 + 新 `alpha2`；`g-base.items` 仍引用 `alpha-mcp`；宿主读模型刷新后 UI 同样显示两条、组引用未改 → 记 KNOWN-DEFECT / LIM-17。后续契约见 MCP-23 | toast + snapshot + store | `Modals.tsx`（`saveServer`）、`modals.ts:105-125`、`src/host/service.ts:179-197`（`mcp.save` upsert） |
| MCP-15 | 已配置密钥留空保留 | MCP-09 后 | 编辑 demo → 环境变量行留空 → 保存 → 再开编辑 | `[DISK] secrets.env.TOKEN` 仍是 `abc`；`[DOM]` secret note `已配置 1 个环境变量（值不读出，留空即保留）`；`[REV] +1` | secrets 键名 + 截图 | `ServerForm.tsx`、`service.ts`（mcp.save 保留未改密钥） |
| MCP-17 | 原文只读 | 选中 `alpha-mcp` | 点 `[data-mcpraw]` `查看原文` | `[DOM]` `textarea#fRaw` 有 `readonly`；文本含 `kind: mcp-server`、`serverName: alpha-mcp`、`transport: stdio`；关闭后 `[REV]`/`[DISK]` 不变 | 截图 + `readonly` 属性 | `McpPane.tsx`、`Modals.tsx`（Raw） |
| MCP-18 | 停用服务器 | 选中 `alpha-mcp` | 点 `[data-mcptoggle]` `停用` | `[TOAST]` `已停用 alpha-mcp（全局）`；`testMsg` `已停用：全部 mcp__alpha-mcp__* 工具从这份定义里消失。`；`[DISK] enabled=false`；预览 MCP 行 `已停用`；预算不再含 120；按钮变 `启用` | toast + store | `McpPane.tsx`、`service.ts`（mcp.toggle） |

### 3.7 预算、诊断与数据层

| 编号 | 场景 | 前置 | 步骤 | 预期 | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| SUM-01 | 预算卡总量 | Fixture G 默认生效 | 看右栏顶部 | `[DOM]` `[aria-label=上下文预算]`；数字 `130 / 200K tok`；`div.budget-bar[role=img][aria-label='生效内容构成占比，共 130 tok']`；状态 `余量充足`；脚注 `<1% 预算 · 估算` | 截图 | `Preview.tsx`（BudgetCard，`CONTEXT_BUDGET`） |
| SUM-03 | 预览内容与自定义 | SUM-01 | 往下看 | `[DOM]` `pv-head ✓ 基础组`、tag `全局`、`≈ 125 tok`；`技能 1` 行 `alpha`；`MCP 服务器 1` 行 `mcp:alpha-mcp`；`自定义提示词 1` 行 `自定义 · 回答风格`；`工具 deny 1`、`技能遮蔽 3` | 截图 + 文本 | `Preview.tsx` |
| SUM-02 | 预算构成图例 | SUM-01 | 看预算卡图例 | `[DOM]` 图例 `上下文 0`、`提示词段 0`、`技能 5`、`MCP 120`、`自定义 5`；零值项带 `zero` 样式 | 截图 | `Preview.tsx`（BudgetCard 图例） |
| SUM-04 | 诊断列表 | SUM-01 | 点 `诊断` 页签 | `[DOM]` `span.n` = `3`；条目：`本组没有包含提示词段`（info）、`有工具被 deny`（warn，action `查看工具`）、`有技能被分组遮蔽`（info，action `查看技能`） | 截图 + a11y | `Preview.tsx`、`selectors.ts`（diagnostics） |
| DAT-01 | secrets 不落 store | MCP-09 后 | 读全局 store.json、secrets.json、snapshot | `[DISK]` store.json 不含 `abc`，只有 `envKeys`；snapshot 的 servers 无 `env`/`headers` 字段；secrets.json 含明文 | store + secrets + snapshot（**secrets 内容只记录键名，不回贴明文**） | `src/host/store.ts`（saveSecrets） |
| DAT-03 | revision 冲突拒绝 | 页面已加载（已知 `R0`） | 页面内 fetch dispatch 用 `expectedRevision:R0` 保存一次（成功，变 `R0+1`）→ 页面再点 `保存草稿` | `[TOAST]` `保存失败：revision conflict: expected R0, current R0+1`；`[DISK]` 只保留 fetch 的改动；`[REV]` 不因页面失败而变 | toast + store | `src/host/service.ts:68-77`（E_REVISION） |
| DAT-05 | 工作区写双文件 revision | 工作区已信任 | 在工作区保存一个自定义 | `[DISK]` 工作区 store `revision+1` **且** 全局 store `revision+1`；其他工作区文件不受影响 | 两个 store 拷贝 | `service.ts:94-102`（LIM-06） |
| DAT-11 | 全局/工作区域写隔离 | 全局与工作区各有一份 store | 全局保存分组 → 工作区保存自定义 | `[DISK]` 全局写不创建/修改工作区文件；工作区写不改其他工作区文件；对应 store 各自 revision +1（全局受记帐 +1） | 三个目录 `ls -l` + 内容 | `service.ts`、`src/host/store.ts` |

### 3.8 无障碍基线

| 编号 | 场景 | 前置 | 步骤 | 预期 | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| UX-01 | 四栏 landmark 与页签角色 | 面板已加载 | `dsh_browser_a11y` | `[DOM]` `nav[aria-label=作用域]`、`nav[aria-label=列表]`、`main[aria-label=编辑]`、`aside[aria-label=生效预览]`；`#pageTabs` `role=tablist`，每个 tab `role=tab` + `aria-selected` | a11y 输出 | `App.tsx`、`PageTabs.tsx` |

### 3.9 上下文面板黑盒（v1 负向，P0）

> 目的：验证“保存并设为生效后，宿主上下文真的被 CSMM 改变了没有”。**当前 v1 的预期是「不变」**，因为 `src/host/index.ts:96` 仍传 `sections: []`，且 host 没有注册 systemPrompt/skills/mcp 注入；这不是缺陷，是未 materialize。**不要把它写成已生效，也不要为了让它通过而改 `src/`。**
>
> **判定口径（三文档一致）**：v1 下三行不变且无分组内容出现 = **PASS（负向通过）**；出现 `技能正文甲`/`示例服务器说明`/分组名等注入内容 = FAIL；无法排除无关宿主活动 = BLOCKED。**KNOWN-DEFECT 只在 `GRP-06`（materialize 缺口）记录，`CTX-01` 不记 KNOWN-DEFECT。**
>
> **可执行性前提**：`GroupEditor.tsx:245` 只在 `effId !== g.id` 时渲染 `[data-effective]`；夹具基线 `activeGroup=g-base`，所以不能直接对 `基础组` 点“设为生效”。CTX-01 先激活 `空组` 解锁按钮，再回到 `基础组` 执行真正的“把带内容的组设为生效”。

| 编号 | 场景 | 前置 | 步骤 | 预期 | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| CTX-01 | 生效组切换后上下文窗口不变化（v1 负向通过） | 重新播种后的 Fixture G（`activeGroup=g-base`）；全局作用域；CSMM 面板已加载；另有一个可对话的会话页（同一 GUI） | ① 切到会话页 → 点会话头 `上下文` 页签 → 记录 `系统提示词`、`技能注入`、`工具定义` 三行的“项数/≈tok/百分比”，截全屏；② 回 CSMM（`click text=CSMM`）→ 断言在全局（`[data-scope=global][aria-current=true]`）→ `click 空组` → `click [data-effective]`（`设为生效`）→ toast `已保存并设为生效：空组` → 页面内 snapshot 断言 `activeGroup["global:"]="g-empty"`；③ `click 基础组` → 断言 `[data-effective]` 存在（`设为生效`）→ 点它 → toast `已保存并设为生效：基础组` → snapshot 断言 `activeGroup["global:"]="g-base"`；④ 点左侧栏原会话名回会话页 → 若上下文面板未保持，点会话头 `上下文` → 再记录同三行 | **v1 预期（负向通过）**：④ 三行与①**一致**；面板文本无 `技能正文甲`、`示例服务器说明`、`基础组`；snapshot `bootstrap.sections=[]`。②③ 的按钮存在性是流程前置：② 空组非生效才有按钮，③ 切走后基础组才有按钮（`GroupEditor.tsx:245`）；按钮不存在 → BLOCKED（前置/夹具问题），不要判 FAIL。出现注入内容 → FAIL；三行因无关宿主活动变化 → BLOCKED 并记录来源 | 两次全屏截图 `01-before.png`/`02-after.png` + 面板文本抽取 + `snapshot.json`（含两步 activeGroup） | `src/host/index.ts:96`（`sections: []`）、`service.ts:277-292`（buildBootstrap）、`GroupEditor.tsx:245` |
| CTX-02 | 未来 materialize 后的正向断言（阻塞） | CTX-01 通过；宿主已实现 systemPrompt/skills/mcp 注入 | 同 CTX-01 的①→④（含先激活 `空组` 解锁 `[data-effective]`、再切回 `基础组` 的两步），但夹具用带唯一标记的组（如提示词段文本含 `CSMM-CTX-MARKER-7f3a`、技能 `alpha`、MCP `alpha-mcp`） | **实现完成后预期**：`系统提示词` 项数/≈tok 增加且面板文本出现 `CSMM-CTX-MARKER-7f3a`；`技能注入` 出现 `alpha`；`工具定义` 出现 `mcp__alpha-mcp__*` 工具（工具行数 ≥1，具体数由服务器定义决定）。v1 下本用例 **BLOCKED**（前置不成立），不得记为 PASS 或 FAIL | 两次截图 + 文本 + 命中项定位 | 待实现：`src/host/index.ts`（注入 seams）、`src/host/service.ts`（sections 来源） |

### 3.10 后续实现断言（当前 BLOCKED，不计入 P0 统计）

> 这两条描述“实现修好之后应有的磁盘/UI 契约”，用于跟踪 SKL-15 / MCP-13 的后续工作；v1 执行时一律 BLOCKED，不得记 PASS/FAIL，也不要用它们替代当前行为断言。

| 编号 | 场景 | 前置 | 步骤 | 预期（实现后） | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| SKL-22 | 迁移应落盘（后续契约） | `runMigrate` 已改为发 `skill.copy`/`skill.save` 并 `sync()` | 同 SKL-15 | `[RPC]` 至少一条写命令；`[REV] +1`；`[DISK]` 目标工作区 skills 含 alpha（同名跳过时无重复）；刷新/切作用域后仍可见；全局定义保留 | 两个 store + snapshot | `modals.ts`（`runMigrate` 待改）、`service.ts`（skill.copy） |
| MCP-23 | 重命名应删旧并改组引用（后续契约） | 宿主 `mcp.save` 支持 rename，或客户端补发删除/改写 | 同 MCP-13 | `[DISK]` 旧 `alpha-mcp` 消失、`alpha2` 存在、`g-base.items` 引用 `alpha2`；若实现选择保留旧名作别名，必须写进实现说明，不能默认两条都算通过 | 两个 store + snapshot | `modals.ts`（`saveServer`）、`service.ts:179-197`（`mcp.save`） |

## 4. P1 用例（回归轮次）

> 完整 P1（矩阵 45 条）不在此重复；下表是每轮必跑的高价值子集，其余按矩阵对应行执行。

| 编号 | 场景 | 前置 | 步骤 | 预期 | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| ENV-06 | 后端未连接错误态 | 临时禁用 host 路由（或停 host 后重载页面） | 打开面板 | `[DOM]` `CSMM 后端未连接：…` + `确认插件 host 已加载，且当前页面与 /dsh-csmm/rpc 同源。` + `重试`；点 `重试` 仍失败则保持错误块 | 截图 | `src/client/index.tsx`（PanelRoot 错误态） |
| TRUST-07 | 信任持久化 | TRUST-05 后 | 刷新页面 → 再进工作区 | `[DOM]` 无弹窗直接加载；`[RPC] trusted:true` | snapshot | `service.ts`（trust.set 写全局 store） |
| GRP-09 | 从“不使用”恢复继承 | GRP-08 状态 | 点 `继承下层` | toast 恢复继承；`[RPC]` 键被删除；预览重新显示全局 `基础组` | snapshot + 截图 | `navigation.ts` |
| GRP-18 | 提示词段白名单（生产为空） | 生产宿主 | 展开组编辑器 `提示词段` details | `[DOM]` `没有匹配的提示词段。`；`全选/清空` 无可操作项；`[RPC] snapshot.bootstrap.sections=[]` → 记 KNOWN-DEFECT / LIM-01 | 截图 + snapshot | `GroupEditor.tsx:36`、`host/index.ts:96` |
| SKL-02 | 技能搜索过滤 | 全局技能页 | `#skillSearch` 输入 `bet`；再输 `zzz`；清空 | 仅 `Beta`；无匹配显示 `没有匹配的技能`；清空恢复 | 截图 | `ItemList.tsx` |
| SKL-13 | 复制到当前工作区（全局侧） | 全局选中 `Beta` | 点 `[data-skillmove=workspace]` | toast `已复制到当前工作区：beta`；工作区 store 新增 beta；全局保留；目标取 `meta.workspaces[0]`（LIM-09） | toast + store | `resources.ts`（moveSkill） |
| MCP-12 | 名称/URL 校验 | 添加表单 | 名称留空 → 保存；填 `alpha+mcp` → 保存；填已有 `alpha-mcp` → 保存 | `[DOM]` `请填写名称`；`只能包含字母、数字、下划线或连字符，1-32 位（不支持空格、点、中文）`；重名 `当前作用域已有同名服务器：alpha-mcp`；弹窗不关 | 截图 | `ServerForm.tsx` |
| SUM-06 | 缺引用诊断 | 选 `缺引用组` → `设为生效` | 点 `诊断` | 3 条 error：分组引用了不存在的提示词段/技能/MCP 服务器；预览该项显示 `缺失`；预算 5 tok（仅自定义） | 截图 | `selectors.ts`（diagnostics） |
| DAT-06 | 重启后持久化 | 已做若干保存 | 按 SOP §6 停实例 → 重启 → 重开面板 | 数据、生效组、信任状态与重启前一致；`[RPC] revision` 保持；`[DISK]` 无临时文件残留 | 重启前后 store 拷贝 + snapshot | `store.ts` |
| UX-04 | 弹窗焦点陷阱 | 打开任意弹窗 | 连续 Tab/Shift+Tab；按 Escape | 焦点在弹窗首尾循环；Escape 关闭并返回焦点；背景 `aria-modal=true` | a11y 输出 | `Modals.tsx` |
| SKL-23 | DSH 技能注册表内联目录（只读） | DSH 全局与受信任工作区各有已注册技能；另有未信任工作区 | 打开技能页（自动加载）；看 `[data-dshitem]`；点 `[data-sktool=refresh]`；点 DSH 行；切未信任工作区 | 「DSH 技能」段出现；行显示描述/来源/provider；刷新可用；`[data-dsh-pane]` 只读详情含来源、调用策略、说明、路径；未信任工作区只显示全局项 + `[data-dsh-restricted]`；`[REV]`/`[DISK]` 不变 | 截图 + store | `ItemList.tsx`、`SkillPane.tsx`、`selectors.ts`、`service.ts` |

## 5. P2 用例（抽查）

| 编号 | 场景 | 前置 | 步骤 | 预期 | 证据 | 关联实现文件 |
|---|---|---|---|---|---|---|
| SKL-03 | 插件技能显示开关 | 全局技能页 | 取消 `#pluginToggle` | `Plug Skill` 消失；再勾选恢复（仅 UI 过滤） | 截图 | `ItemList.tsx` |
| GRP-22 | Ctrl+S 保存草稿 | 选中 `基础组`，改名 | 按 `Ctrl+S` | toast `分组已保存`；store 名称更新；弹窗打开时无效 | toast + store | `GroupEditor.tsx:74-84` |
| SUM-09 | 预算警戒/超限 | 另建夹具：`alpha-mcp.tokens=185000`，`g-base` 生效 | 看预算卡 | `185010 / 200K tok`；class `danger`；状态 `超过 90%，建议拆分`；诊断 `上下文预算偏紧`（error） | 截图 | `Preview.tsx` |
| DAT-08 | 锁冲突 | 手工创建 `store.lock` | 页面保存 | toast `保存失败：store is locked: <path>`；无写入；删锁后重试成功 | toast + `ls` | `store.ts`（acquireLock） |
| UX-06 | 响应式断点 | 桌面窗口 | 缩窄窗口到 <1180/<960/<640 | 1180 以下列宽收紧；960 以下单列；640 以下 MCP 表单单列；无横向溢出（当前浏览器工具无 viewport 接口，人工拖拽 + LIM-12） | 截图（人工） | `src/UI/styles.css` |
| SKL-21 | 批量选择与迁移预选 | 全局技能页 | 勾选 2 个技能 → 批量 `复制` | 底部 `已选 2`；迁移弹窗中已预选；`清空` 生效 | 截图 | `ItemList.tsx`、`Modals.tsx` |

## 6. 与 t2 矩阵的覆盖关系

- **P0**：矩阵标为 P0 的 60 条全部进入 §3；其中 `GRP-06` 的“预期”按已知限制写成负向断言，执行时记 `KNOWN-DEFECT`。新增的 `CTX-01` 是“当前实现负向通过”用例：三行不变即记 `PASS`，**不是 KNOWN-DEFECT**；materialize 缺口只由 `GRP-06` 记录。§3 另含 `CTX-02`（未来正向，v1 BLOCKED）。
- **P1/P2**：§4/§5 是子集；其余条目在扩展轮次直接打开 `docs/BROWSER-TEST-MATRIX.md` 对应行执行，编号相同。矩阵中未详列的 P1：`ENV-04/05`、`SCOPE-04/05/06/07`、`TRUST-08`、`GRP-04/10/14/16/20`、`SKL-06/08/14/16`、`MCP-02/05/11/14/16/19/20`、`CUS-03/05/06`、`SUM-05/07/08/10/11/12`、`DAT-10`、`UX-03/07`；P2：`ENV-07`、`GRP-17/21`、`SKL-17/20`、`MCP-06/08/21/22`、`DAT-02/04/07/09`、`UX-02/05`。
- 矩阵 §4 的 17 条已知限制（LIM-01…LIM-17；LIM-16/17 为 t5 依据实现补充）在本清单中以 `关联实现文件`/`预期` 的形式就地引用；SOP §7 有汇总与取证口径。§3.10 的 `SKL-22`/`MCP-23` 是后续契约，不计入矩阵 60 条 P0。

## 7. 维护规则

1. 改 `src/**` 的选择器、文案、命令语义 → 同步改本清单与 SOP §3/§4；以矩阵编号为锚点。
2. 新增 P0 必须先有“可观察、可取证、可失败”的断言，再加进 §3；禁止只写“点击后正常”。
3. 已知缺陷被修复后，把对应行从 `KNOWN-DEFECT` 改为 PASS，并在 `notes.md` 记录修复提交。
4. 本清单不承诺覆盖宿主真实上下文注入；`CTX-02` 在 materialize 落地前保持 BLOCKED。
