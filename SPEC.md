# 双作用域配置规格：全局配置档 + 工作区

状态：功能规格 v2（按 15 条裁决修订，逐条落点见 §11）。读者是未读过本仓历史文档的实现者；本文自足。配套导读：[README.md](README.md)；VS Code 对照：[VSCODE-MAPPING.md](VSCODE-MAPPING.md)。两份均非规范，冲突以本文为准。
依据：用户要求「参考 VS Code 的工作区/配置管理形式，尽量向它靠拢」。VS Code 事实来源见 §8。
规范词：「必须」= 违反即测试失败；「禁止」= 出现即测试失败；「可以」= 实现可选。

## 1. 名词表

| 术语 | 一句话定义 |
|---|---|
| 作用域 | 配置与文件的归属单位，只有两档：全局（用户级，跨项目）与工作区（项目根下）。 |
| 配置档 | 全局侧的一份命名配置清单文件（profile），声明若干实体与每项的 enabled；工作区通过 bindProfile 选用一份。 |
| 实体 | 一条具名配置，身份由键 kind:id 唯一确定；三类 kind：prompt、skill、mcp。 |
| 键 | 实体的机器标识，写作 prompt:<id>、skill:<id>、mcp:<id>；逐键覆盖、诊断、排序都以键为准。 |
| 覆盖 | 工作区对某个键给出自己的值（整值替换，不做字段合并）；未覆盖的键沿用全局层。 |
| 锁定 | 默认层 lockedKeys 数组声明的键；任何非默认层（配置档或工作区）以同一键声明（覆盖或禁用）即触碰，产生 E_LOCKED，键保留全局值。 |
| 信任 | 每个键的可执行性要求，按 kind 与声明层确定；未信任工作区中，最终值来自工作区且要求信任的键不生效。 |
| 技能清单 | 宿主预读的映射 M：键 global:<id> 或 workspace:<id>，值 {name, requiresTrust}；来源是各层 skillsRoot 下 SKILL.md 的 frontmatter。resolve 只读 M，不读盘。 |
| 生效集 | 某一工作区在某一时刻实际可用的实体集合，由 §4 的算法唯一确定。 |
| 施加 | 把某一作用域的配置文件写到磁盘的动作；每域施加器只写本域文件。 |

## 2. 目录布局

### 2.1 全局侧

全局根由宿主提供（记作 $DSH_HOME；本规格不规定绝对路径，也不假设任何索引或发现服务）。

| 路径 | 内容 | 是否入库 |
|---|---|---|
| $DSH_HOME/profiles/default.json | 默认层；声明 lockedKeys 与基础实体；不存在时按空清单处理 | 不入库（用户私有） |
| $DSH_HOME/profiles/<name>.json | 其余配置档，每个文件一份 | 不入库 |
| $DSH_HOME/skills/<id>/SKILL.md | 全局技能，frontmatter 见 §3.5，目录名即技能 id | 不入库 |
| $DSH_HOME/trust.json | 已信任工作区根路径列表（用户动作写入） | 不入库 |
| $DSH_HOME/.state/ | 施加日志、锁、备份 | 不入库 |

### 2.2 工作区侧

工作区根 = 项目根（单根；多根见 §8 偏差 4）。

| 路径 | 内容 | 是否入库 |
|---|---|---|
| <root>/.dsh/settings.json | bindProfile 与 prompt/skill 的覆盖、新增、禁用 | 必须入库 |
| <root>/.dsh/mcp.json | mcp 的覆盖、新增、禁用与工具禁用名单 | 必须入库 |
| <root>/.dsh/skills/<id>/SKILL.md | 工作区技能，frontmatter 见 §3.5，目录名即技能 id | 必须入库 |
| <root>/.dsh/.state/ | 施加日志、锁、备份 | 禁止入库 |

### 2.3 提交策略

1. 工作区三处配置（settings.json、mcp.json、skills/）必须入库：它们是团队共享的项目意图。
2. .dsh/.state/ 禁止入库：其中含锁持有者、进程号、回滚备份，属于机器状态；仓库必须在 .gitignore 中列出 .dsh/.state/。
3. 信任状态只存 $DSH_HOME/trust.json，禁止写入工作区任何文件：信任是个人安全决定，不能随仓库分发。
4. 全局配置档不入库：它是个人环境，不是项目事实。

## 3. Schema

### 3.1 公共约定

| 约定 | 规则 | 违反 |
|---|---|---|
| 编码 | UTF-8，无 BOM；JSON 对象，禁止注释与尾逗号 | E_PARSE |
| schema | 每个文件必须有整数 schema；当前唯一取值 1 | E_SCHEMA |
| 未知字段 | 禁止 | E_PAYLOAD（丢该键） |
| id | ^[a-z][a-z0-9-]{1,63}$；同一文件内同 kind 唯一；不同 kind 可同 id | E_DUP / E_PAYLOAD |
| name | 选填显示名，不参与判定；重复不报错 | — |
| 整值覆盖 | 工作区对一个键给值即替换整项，不与全局值做字段合并 | — |

kind 与 requiresTrust 的声明权：

| kind | item 可否声明 requiresTrust | 生效值来源 | 默认 |
|---|---|---|---|
| prompt | 可以（true/false） | item 声明 | false（惰性文本不拦） |
| skill | 禁止；声明即 E_PAYLOAD | 该层 SKILL.md frontmatter（经 M 读取） | false |
| mcp | 只可 true；false 即 E_PAYLOAD（不得放宽） | item 声明 | true |

### 3.2 配置档 profiles/<name>.json

默认层与配置档同构（默认层示例见 §3.7）；下例是配置档，**不含 `lockedKeys`**——锁定只属于默认层。

```json
{
  "schema": 1,
  "profile": "frontend",
  "items": [
    { "kind": "prompt", "id": "base", "payload": { "text": "你是前端工程师。", "order": 100 } },
    { "kind": "skill", "id": "release-notes", "enabled": false },
    { "kind": "mcp", "id": "jira", "payload": { "command": "dsh-mcp-jira", "args": [] } }
  ]
}
```

| 字段 | 必填 | 约束 | 违反 |
|---|---|---|---|
| profile | 是 | 与文件名（去 .json）一致；default 为保留名 | E_SCHEMA |
| lockedKeys | 仅默认层 | 键数组；每项必须是默认层已声明的键；**任何非默认层禁止出现** | 非默认层出现 → E_LOCKED；指向不存在的键 → E_PAYLOAD。锁定键可在默认层被 `enabled:false`：此时「全局值」= 键不存在，非默认层以 `enabled:true` 重开同样 → E_LOCKED |
| items[].kind | 是 | prompt / skill / mcp 之一 | E_KIND |
| items[].id | 是 | 见 §3.1；技能 id 必须等于技能目录名 | E_DUP / E_PAYLOAD |
| items[].enabled | 否 | 布尔，默认 true | E_PAYLOAD |
| items[].requiresTrust | 否 | 见 §3.1 声明权表 | E_PAYLOAD |
| items[].payload | 是 | prompt {text, order?}；skill {}；mcp {command, args?, env?, tools?} | E_PAYLOAD |

说明：item 不携带锁定标志；锁定只由默认层 lockedKeys 表达。锁定针对键而不是值：默认层禁用某键后仍可锁定它，效果是该键在本工作区永远不存在。

### 3.3 工作区 .dsh/settings.json

```json
{
  "schema": 1,
  "bindProfile": "frontend",
  "items": [
    { "kind": "prompt", "id": "repo-rules", "payload": { "text": "本仓用 pnpm。", "order": 150 } },
    { "kind": "skill", "id": "data-migration", "payload": {} },
    { "kind": "prompt", "id": "security", "enabled": false }
  ]
}
```

| 字段 | 必填 | 约束 | 违反 |
|---|---|---|---|
| bindProfile | 否 | 指向 $DSH_HOME/profiles/ 下存在且可解析的配置档；缺省时只用默认层 | E_PROFILE（fatal） |
| items[].kind | 是 | 只允许 prompt 或 skill；mcp 一律放 mcp.json | E_KIND |
| items[].enabled | 否 | 布尔，默认 true；false = 该键在本工作区关闭 | E_PAYLOAD |
| items[].requiresTrust | 否 | 只对 prompt 有效；skill 禁止声明 | E_PAYLOAD |
| items[].payload | 是 | prompt {text, order?}；skill {}（技能详情看 SKILL.md） | E_PAYLOAD |
| lockedKeys | 禁止 | 工作区文件不得出现 | E_LOCKED |

### 3.4 工作区 .dsh/mcp.json

```json
{
  "schema": 1,
  "servers": [
    { "id": "github", "enabled": false },
    { "id": "local-db", "command": "dsh-mcp-sqlite", "args": ["./dev.db"], "tools": { "deny": ["drop_table"] } }
  ]
}
```

| 字段 | 必填 | 约束 | 违反 |
|---|---|---|---|
| servers[].id | 是 | 键恒为 mcp:<id>；同文件唯一 | E_DUP |
| servers[].enabled | 否 | 布尔，默认 true | E_PAYLOAD |
| servers[].command | 覆盖/新增时必填 | 非空字符串；只给 id 与 enabled 表示"只改开关" | E_PAYLOAD |
| servers[].args / env | 否 | 字符串数组 / 字符串映射 | E_PAYLOAD |
| servers[].requiresTrust | 否 | 只可 true；false 即 E_PAYLOAD | E_PAYLOAD |
| servers[].tools.deny | 否 | 工具名数组；未知工具在挂载期 W_TOOL | W_TOOL |

「只改开关」是唯一允许的载荷缺省：{"id":"github","enabled":false} 合法；要覆盖命令必须同时给出 command，整值替换。

### 3.5 技能声明 <skillsRoot>/<id>/SKILL.md

技能身份只由 id 与目录名决定：目录名即 id，且必须等于 frontmatter 的 name；item 不携带任何路径字段（技能位置由 skillsRoot 与目录名决定）。

```yaml
---
name: data-migration
description: 迁移脚本编写
requiresTrust: true
---
```

| 规则 | 违反 |
|---|---|
| frontmatter 必须存在且可解析，name 必填并等于目录名 | E_PAYLOAD（丢该技能键） |
| requiresTrust 只能来自 frontmatter；item 声明无效且报 E_PAYLOAD | E_PAYLOAD |
| 工作区技能清单缺失（目录存在但宿主未读到 SKILL.md） | E_PAYLOAD（丢该技能键） |
| 未被任何配置档或工作区 items 声明的技能目录不生效（目录存在不等于启用） | — |

M 的键集合必须等于 skillsRoot 扫描得到的技能集合；M 缺键或 frontmatter 非法时，对应 skill 键丢弃并报 E_PAYLOAD，其余键照常。

### 3.6 用户侧信任文件 $DSH_HOME/trust.json

```json
{ "schema": 1, "trustedRoots": ["/home/alice/work/payments"] }
```

路径规则：绝对路径，经 realpath 解析符号链接后按平台大小写规则归一（大小写不敏感文件系统统一小写）；末尾分隔符去掉。信任写入是用户动作，不经过施加流程。

### 3.7 完整示例

默认层 default.json：

```json
{
  "schema": 1,
  "profile": "default",
  "lockedKeys": ["prompt:security"],
  "items": [
    { "kind": "prompt", "id": "base", "payload": { "text": "你是严谨的工程师。", "order": 100 } },
    { "kind": "prompt", "id": "security", "payload": { "text": "禁止输出任何密钥。", "order": 200 } },
    { "kind": "skill", "id": "code-review", "payload": {} },
    { "kind": "skill", "id": "release-notes", "payload": {} },
    { "kind": "mcp", "id": "github", "payload": { "command": "dsh-mcp-github" } }
  ]
}
```

配置档 frontend.json：见 §3.2。工作区 settings.json：见 §3.3。工作区 mcp.json：见 §3.4。

技能清单 M（宿主读取）：

```json
{
  "global:code-review": { "name": "code-review", "requiresTrust": false },
  "global:release-notes": { "name": "release-notes", "requiresTrust": false },
  "workspace:data-migration": { "name": "data-migration", "requiresTrust": true }
}
```

trust.json 不含该工作区路径（未信任）。

## 4. 生效算法

### 4.1 六输入

| 输入 | 含义 | 缺失/非法时 |
|---|---|---|
| D | 默认层（profiles/default.json，含 lockedKeys） | 视为空清单，不报错 |
| P | 绑定的配置档（可为空） | bindProfile 缺失则无此层；指向缺失/不可解析 → E_PROFILE |
| Ws | 工作区 settings.json | 文件缺失视为空清单 |
| Wm | 工作区 mcp.json | 文件缺失视为空清单 |
| trust | 本工作区是否信任（布尔） | 信任存储缺失 → 按 false 处理 |
| M | 技能清单映射 `M["<scope>:<id>"] = {name, requiresTrust}`，scope ∈ {global, workspace}（宿主预读 frontmatter） | 缺键或非法 → 对应 skill 键丢弃并 E_PAYLOAD |

M 的键集合必须与 skillsRoot 扫描集合一致（含任何层声明为 `enabled:false` 的技能——禁用项可能被工作区重开，届时仍需 frontmatter 判定）；不一致即 E_PAYLOAD（T25-04）。resolve 期间零 IO：D/P/Ws/Wm/trust/M 全部以已解析数据传入，I1 据此可测。

### 4.2 伪代码

```text
resolve(D, P, Ws, Wm, trust, M):
  validateFiles()                 # schema/parse/dup/kind：fatal 即返回，无 Effective
  lockedSet = D.lockedKeys            # 非默认层的 lockedKeys 已报 E_LOCKED 并忽略
  named = {}
  putAll(named, D.items, origin="default")        # 默认层照常写入
  for each item in P.items:                        # 配置档层
      key = item.kind + ":" + item.id
      if key in lockedSet: diags += E_LOCKED(key); continue
      named[key] = {value: item, origin: "profile"}
  for each item in Ws.items:                       # 工作区 settings
      key = item.kind + ":" + item.id
      if key in lockedSet: diags += E_LOCKED(key); continue
      named[key] = {value: item, origin: "workspace"}
  for each s in Wm.servers:                        # 工作区 mcp：键恒为 mcp:<id>
      key = "mcp:" + s.id
      if key in lockedSet: diags += E_LOCKED(key); continue
      named[key] = {value: s, origin: "workspace"}
  for key in named:                                # 清单一致性先于删除：禁用技能也必须有清单
      if kindOf(key) == "skill":
          mk = scopeOf(named[key].origin) + ":" + key.slice(6)
          if mk not in M:
              delete named[key]; diags += E_PAYLOAD(key)  # fail-closed，不做信任推断
  for key in named:
      if named[key].value.enabled == false: delete named[key]
  for key in named:                                # 信任门
      if named[key].origin == "workspace" and trust == false
         and requiresTrust(key, named[key]):
              delete named[key]; diags += W_TRUST(key)
  return {Effective: sort(named), Diagnostics: diags}

requiresTrust(key, item):
  kind = kindOf(key)          # key 前缀即 kind，与 item 字段无关
  if kind == "mcp":    return item.value.requiresTrust != false   # 默认 true
  if kind == "prompt": return item.value.requiresTrust == true    # 默认 false
  return M[scopeOf(item.origin) + ":" + key.slice(6)].requiresTrust == true   # 清单一致性循环已保证存在
```

排序细则：kind 升序（prompt < skill < mcp）；prompt 内按 (order 升序, id 的 UTF-8 字节序)，order 缺省 1000；skill、mcp 内按 id 字节序。id 限定 ASCII，字节序与 locale 无关。

### 4.3 复杂度、纯函数与确定性

- 时间 O(n log n)：n = 六输入中的键总数；索引与 M 查询 O(1)。
- 空间 O(n)。
- 纯函数：算法只读六个入参，无 IO、时钟、随机、环境变量；覆盖顺序固定为 默认 → 配置档 → 工作区。
- 确定性：输出按 §4.2 全序排序；同一组输入在任何实现、任何机器上给出同一序列。
- 幂等：resolve 不读磁盘现状；施加侧按 diff 写文件，写后重算 diff 为空（§5.2）。

### 4.4 规则细则

| 情形 | 结果 |
|---|---|
| 非默认层声明 lockedKeys | E_LOCKED（error）；该声明被忽略，不改锁定集合 |
| 配置档覆盖或禁用锁定键 | E_LOCKED；键保留全局值（默认层值；配置档的叠加已被拒） |
| 工作区覆盖或禁用锁定键 | E_LOCKED；键保留全局值，工作区其余键照常 |
| 工作区以新 id 声明（改 id） | 这是另一个键，不触碰锁定键；锁定键原值不变（A3c 断言） |
| bindProfile 缺失 | 只用默认层，不报错 |
| bindProfile 指向缺失或不可解析的配置档 | E_PROFILE（fatal）；该工作区无 Effective、不施加 |
| 工作区 mcp 只给 id 与 enabled | 键为 mcp:<id>；不要求 command，也不产生其它键（A16） |
| 工作区技能 item 声明 requiresTrust | E_PAYLOAD；判定只读 frontmatter，伪造无效（A15） |
| 未信任 + origin=workspace + requiresTrust | 丢弃该键并 W_TRUST |
| 未信任 + origin=default/profile | 不受信任门影响：用户级配置视为可信 |
| 任一 E_PAYLOAD | 丢弃该键；同一文件其余键照常施加 |

E_PAYLOAD 的处置在全文只有一个口径（§6）：丢键、续施，不存在「整份文件不可施加」。

### 4.5 手算示例（§3.7 的输入）

| 键 | 默认层 | frontend | 工作区 | 生效（已信任） | 生效（未信任） |
|---|---|---|---|---|---|
| prompt:base | text=严谨，order=100 | text=前端，order=100 | — | profile 值 | profile 值 |
| prompt:security | lockedKeys 成员，order=200 | — | enabled:false（被拒，E_LOCKED） | 默认值 | 默认值 |
| prompt:repo-rules | — | — | text=pnpm，order=150 | 工作区值 | 工作区值 |
| skill:code-review | 启用 | — | — | 启用 | 启用 |
| skill:release-notes | 启用 | enabled:false | — | 不生效 | 不生效 |
| skill:data-migration | — | — | 新增；M 显示 requiresTrust=true | 启用 | 不生效（W_TRUST） |
| mcp:github | command=dsh-mcp-github | — | enabled:false | 不生效 | 不生效 |
| mcp:jira | — | 新增 command=dsh-mcp-jira | — | 启用 | 启用（全局值，可信） |
| mcp:local-db | — | — | 新增 command=dsh-mcp-sqlite | 启用 | 不生效（W_TRUST） |

trusted：prompt = base(100)、repo-rules(150)、security(200)；skill = code-review、data-migration；mcp = jira、local-db。
untrusted：prompt 同上；skill = code-review；mcp = jira。诊断：E_LOCKED×1、W_TRUST×2。

## 5. 施加与原子性

### 5.0 宿主物化契约

| 契约项 | 宿主必须提供 | 缺失时降级 | 级别 |
|---|---|---|---|
| profiles root | 可读写 $DSH_HOME/profiles，按文件名解析配置档 | 仅默认层可用；bindProfile 触发 E_PROFILE；提示初始化 | 降级 |
| 全局 skillsRoot | 目录路径与 SKILL.md 扫描清单（进入 M） | 全局技能键全部 E_PAYLOAD；其它 kind 继续 | 降级 |
| 工作区 skillsRoot | <root>/.dsh/skills 与清单 | 工作区技能键全部 E_PAYLOAD；其余继续 | 降级 |
| trust store | 读 $DSH_HOME/trust.json；缺失视为未信任 | 全部工作区项按未信任处理，W_TRUST | 降级 |
| prompt 注入钩子 | 按 id 白名单注入并按 order 排序 | prompt 面无法物化：返回 E_APPLY 并显式报错 | 阻塞 |
| skill allowlist | 按 id 启用/禁用技能集的接口 | 技能面无法物化：E_APPLY，显式报错 | 阻塞 |
| mcp 启停 | 按 id 启动/停止外部命令的接口 | mcp 面无法物化：E_APPLY，显式报错 | 阻塞 |
| 原子替换 + fsync | 平台原子替换与落盘原语 | 拒绝施加（E_APPLY），不得退化为普通写 | 阻塞 |
| 清单快照 M | 六输入之一，宿主预读 | 所有 skill 键丢弃并 E_PAYLOAD（fail-closed）；prompt 与 mcp 面照常 | 降级 |

§5.0 的阻塞项任一缺失 ⇒ 整体施加在 preflight 阶段终止：不写任何文件、不创建 `apply.json`，返回 E_APPLY 并携带契约项名。这是「未开始」状态，不属于 §5.5 的 apply.json 五值，也不受 I7 约束（I7 只约束进入 writing 之后）。禁止静默跳过，也禁止只施加其余资源面——多域施加是全有或全无。

### 5.1 谁写什么

| 域 | 施加器 | 只允许写 | 禁止 |
|---|---|---|---|
| 全局 | 全局施加器 | $DSH_HOME/profiles/*.json、$DSH_HOME/.state/** | 写任何 <root>/.dsh/** |
| 工作区 | 工作区施加器 | <root>/.dsh/settings.json、<root>/.dsh/mcp.json、<root>/.dsh/.state/** | 写 $DSH_HOME/** 或其它工作区 |
| — | 协调者 | 不写任何文件 | 直接落笔（只排序、调用、回滚） |

信任文件与技能目录内容不由施加器代写：前者是用户动作，后者是仓库内容。

### 5.2 流程

1. 解析与校验：对目标域的全部输入跑 §4 校验；文件级 fatal 则零写入返回。
2. 计算目标字节：规范 JSON（2 空格缩进、LF、键序固定、末尾一个换行）。
3. diff：逐文件比较目标字节与现状；相同则跳过。
4. 备份：为每个待写文件写同目录备份（含时间戳与内容哈希），意图写入 .state/apply.json（writing）。
5. 写入：逐文件「临时文件 → 落盘 → 原子替换」；禁止先删除目标再改名。
6. 校验：重新解析每个写入文件并与目标字节比较；不等即失败。
7. 提交或回滚：全部通过 → apply.json=committed；失败 → 尽力逆序回滚并置 rolled-back / failed / partial（§5.5）。
8. 审计：记录域、文件列表、diff 摘要、耗时、失败点。

### 5.3 原子替换原语

| 平台 | 必须使用 |
|---|---|
| POSIX | write(tmp) → fsync(tmp) → rename(tmp, target) → fsync(dir) |
| Windows | write(tmp) → FlushFileBuffers → ReplaceFile/MoveFileEx(REPLACE_EXISTING) |

禁止 unlink(target) 后再 rename：删除与改名之间崩溃会留下「文件消失」的半态（§10-L1）。

### 5.4 锁与半态恢复

- 每个域一把锁：.state/lock 记录 {owner, pid, host, acquiredAt, heartbeatAt, expiresAt}。
- 持锁者每 5 秒更新 heartbeatAt；expiresAt = heartbeatAt + 30 秒。
- 只有 expiresAt 已过且连续两次心跳缺失，才允许接管；接管写审计记录，不新增诊断码。
- 启动时读 .state/apply.json：writing 且锁已过期 → 按备份恢复并置 rolled-back；committed → 清理备份（保留最近 3 份）；failed/partial → 保留现场，UI 显示「上次施加未完成」。
- 状态取值只有五种：writing、committed、rolled-back、failed、partial。

### 5.5 失败语义

| 失败点 | 现场 | 处理 | apply.json |
|---|---|---|---|
| 校验失败（fatal） | 无写入 | 返回诊断 | 不创建 |
| 契约缺失（preflight） | 无写入 | 返回 E_APPLY 并携带契约项名（未进入 writing） | 不创建 |
| 备份失败 | 无写入 | E_APPLY | failed（已写文件为空） |
| 写入中途失败 | 部分新字节 | 尽力逆序回滚 | failed + 已写文件清单 |
| 校验不一致 | 部分新字节 | 尽力回滚 | failed + 已写文件清单 |
| 回滚成功 | 旧字节 | 返回 E_APPLY；修正后可重试 | rolled-back |
| 回滚失败 | 混合字节 | 返回 E_APPLY 并标 partial；下一次施加前必须先处理 | partial + 已写文件清单 |

「修正后可重试」指 failed/rolled-back：用户处理失败原因后可直接重跑。partial 是显式失败态：必须先恢复或放弃，否则施加器以 E_APPLY 拒绝运行（§7-I7）。

## 6. 诊断码表

严重度：fatal = 该工作区或文件不产出结果；error = 该键被拒绝、其余继续；warn = 行为不变，仅提示。
级别：file = 整份文件；key = 单个键；workspace = 整份工作区。

| 码 | 阶段 | 严重度 | 级别 | 触发（唯一口径） | 处置 |
|---|---|---|---|---|---|
| E_SCHEMA | 解析 | fatal | file | schema 缺失、非整数或不为 1；文件内 `profile` 字段与文件名（去 .json）不一致（含 default 保留名） | 拒绝文件 |
| E_PARSE | 解析 | fatal | file | JSON 不可解析、编码非 UTF-8、含 BOM | 拒绝文件；指出字节偏移 |
| E_DUP | 解析 | fatal | file | 同一文件内重复键（实体或服务器） | 拒绝文件；列出重复键 |
| E_KIND | 解析 | fatal | file | kind 不在枚举内，或文件分工不符（mcp 出现在 settings.json） | 拒绝文件；指出允许的 kind |
| E_PAYLOAD | 解析 | error | key | 该键的声明违反 §3 约束：未知字段、载荷缺字段、技能 item 声明 requiresTrust、mcp 声明 requiresTrust:false、技能 id 与目录名或 frontmatter 不符、M 缺键或 frontmatter 非法、lockedKeys 指向不存在的键 | 丢弃该键；同一文件其余键照常施加 |
| E_LOCKED | 生效 | error | key | 非默认层触碰锁定键：以同一键覆盖或禁用，或在非默认文件中出现 lockedKeys | 丢弃该层声明，键保留全局值 |
| E_PROFILE | 生效 | fatal | workspace | bindProfile 指向不存在或不可解析的配置档（单一触发） | 该工作区不产出生效集、不施加 |
| E_APPLY | 施加 | fatal | workspace | §5.0 阻塞契约项缺失（preflight）；或备份、写入、校验、回滚任一步失败（writing 之后） | preflight：不写文件、不创建 apply.json；writing 之后：尽力回滚，apply.json 记 failed/partial 与已写文件清单；修正后可重试 |
| W_TRUST | 生效 | warn | key | 未信任工作区中，origin=workspace 且 requiresTrust 的键 | 该项不生效；其余继续 |
| W_TOOL | 挂载 | warn | key | tools.deny 中的工具名在挂载期不存在 | 移除是空操作；不改其它工具 |

口径唯一性：诊断码只在 §6 定义；其它章节只引用码名。总数必须为 10，新增能力前先合并旧码，禁止第 11 个。
E_DUP/E_KIND 只负责「文件整体不可信」，E_PAYLOAD 只负责「单键声明违规」；同一症状只归一码，禁止重叠。

## 7. 不变量

| # | 不变量 | 测试方式 |
|---|---|---|
| I1 | resolve 是纯函数：同一六元输入两次调用输出逐字段相等，且期间零 IO | A2（--twice --check-no-io） |
| I2 | 最近者胜：任一未被锁定的键，若工作区给出值，则生效值等于工作区值 | 逐键抽样断言 |
| I3 | 锁定优先：锁定键的生效值恒等于其全局值；全局值 = 默认层与配置档层叠加后的值（锁定键上配置档叠加被拒，故等于默认层值）；若默认层禁用该键，全局值 = 键不存在，任何非默认层不得重开；每次触碰恰一条 E_LOCKED | A3a/A3b/A3c/A3d |
| I4 | 域写隔离：一次施加只改动本域文件；对照域所有文件哈希不变 | A7 |
| I5 | 信任门：未信任工作区不产出任何 origin=workspace 且 requiresTrust 的键；每项恰一条 W_TRUST | A4/A5 |
| I6 | 确定性排序：kind 升序；prompt 按 (order, id)；skill/mcp 按 id 字节序 | A11 |
| I7 | 施加结局只有四种可观察状态：success（全部目标文件新字节）、rolled-back（全部旧字节）、failed（未回滚，apply.json=failed 且列出已写文件）、partial（回滚未完成，apply.json=partial 且列出已写文件并显式标记）。不存在「apply.json=committed 而内容为旧字节或混合字节」的文件；partial 存在时下一次施加前必须先处理，否则以 E_APPLY 拒绝运行 | A9/A10 |

## 8. 与 VS Code 的偏差

逐条对照、迁移场景与官方链接整理见 [VSCODE-MAPPING.md](VSCODE-MAPPING.md)；该文非规范，事实与结论以本节为准。

| # | 偏差 | 理由 | 代价 |
|---|---|---|---|
| 1 | 概念重叠、模型不同：VS Code 已有 Agent Skills（工作区 .github/skills/<name>/SKILL.md，目录名必须等于 frontmatter name），但 VS Code 的 skill 不做作用域分组与锁定；本规格把 prompt、skill、mcp 一起纳入统一的配置档/逐键覆盖/锁定模型 | 三类资源需要同一套覆盖与锁定语义，否则每个资源各自一套规则 | 与 VS Code 的 skill 目录约定不同，不能直接复用其技能发现流程 |
| 2 | 工作区 MCP 放在 <root>/.dsh/mcp.json；VS Code 的工作区 MCP 配置在工作区根 .mcp.json | MCP 是可执行配置，独立文件便于按文件做信任门与 diff | 与 VS Code 路径不同，迁移需重命名并转写字段；两个工具不能共享一份文件 |
| 3 | 信任门只覆盖「会触发外部行为」的项：工作区声明的 mcp（默认 requireTrust）、requiresTrust 技能、显式 opt-in 的 prompt。VS Code Restricted Mode 还会禁用或限制 AI agents、terminal、tasks、debugging、workspace settings 与未声明支持信任的扩展 | 本产品只有三类资源，可执行面只有 MCP 与技能载荷；prompt 是惰性文本 | 团队若在提示词里塞命令，需靠评审或把该键加入 lockedKeys，运行时门禁不覆盖 |
| 4 | 不支持多根工作区（.code-workspace 的 folders）；每个项目根各自一份 .dsh/ | 规格面向单根仓库；多根会引入「哪个根持有配置」的额外模型 | monorepo 多根需要每根一份配置，或等待后续规格 |
| 5 | 无用户侧 profile 切换：`bindProfile` 写在工作区文件里、可提交，是唯一的配置档选择器。VS Code 的 profile 与文件夹关联属用户侧持久状态，工作区不能提交该选择；本规格把它降为仓库资产，团队共享同一个绑定 | 团队要共享基线；个人偏好用逐键覆盖表达 | 个人无法在不改工作区文件的情况下临时切档（可改本地未提交的副本）；没有「打开文件夹即切换」的自动激活 |
| 6 | 覆盖是整值替换，不做字段级合并 | 字段级合并会引入「哪些字段可覆盖」的白名单与合并顺序，破坏可手算性 | 只想改 prompt 文本时也要重写 order |
| 7 | 没有语言特定设置（VS Code 中 language-specific user 设置可压过非 language-specific workspace 设置） | 三类资源里只有 prompt 有序，技能与 MCP 没有语言维度 | 多语言仓库无法按语言切换提示词，只能建多个配置档 |
| 8 | 锁定是默认层数据（lockedKeys），VS Code 是固定的 application 级设置清单 | 数据字段可由管理员按组织策略下发 | 需校验 lockedKeys 只能出现在默认层（E_LOCKED），并防止工作区伪造 |

VS Code 依据：设置作用域与覆盖规则、application 级不可被工作区覆盖见 https://code.visualstudio.com/docs/configure/settings ；多根工作区见 https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces ；配置档与「部分配置档」见 https://code.visualstudio.com/docs/configure/profiles ；信任与受限模式见 https://code.visualstudio.com/docs/editing/workspaces/workspace-trust 。

## 9. 验收标准

### 9.1 术语与执行约定

| 术语 | 定义 |
|---|---|
| realpath | 解析全部符号链接后的绝对规范路径；大小写不敏感文件系统统一小写 |
| sha256 | 文件字节的 SHA-256；平台等价命令（sha256sum / certutil -hashfile）均可 |
| 锁文件 | .state/lock，内容为 §5.4 的 JSON；判断「已过期」以 expiresAt 为准 |
| apply.json 状态 | writing / committed / rolled-back / failed / partial 五值，含义见 §5.5 |
| 夹具 | fixtures/ 下一个目录，含六输入（default.json、profiles/、workspace/settings.json、workspace/mcp.json、workspace/skills/、trust.json） |
| harness | dsh-spec-resolve --fixture <dir> [--trust true|false] [--apply] [--twice] [--check-no-io] [--fail-at N] [--missing-seam <name>]；退出码 0=成功、2=文件级 fatal、4=施加失败（含 preflight 契约缺失） |

### 9.2 夹具

- fixtures/two-scope：§3.7 的默认层、frontend、工作区 settings/mcp、data-migration/SKILL.md（name=data-migration，requiresTrust=true）、code-review/SKILL.md、release-notes/SKILL.md（name=release-notes，requiresTrust=false）；trust.json 为空。三个 SKILL.md 合起来必须等于 §3.7 M 的键集合。
- fixtures/locked-profile：frontend 覆盖 prompt:security。
- fixtures/locked-workspace：工作区对 prompt:security 写 enabled:false。
- fixtures/locked-abuse：frontend 声明 lockedKeys。
- fixtures/locked-disabled：默认层 `prompt:security` 为 `enabled:false` 且列入 lockedKeys；工作区声明 `enabled:true`。
- fixtures/missing-profile：bindProfile 指向不存在文件。
- fixtures/trust-forged：工作区 skill:data-migration 的 item 伪造 requiresTrust:false。
- fixtures/mcp-toggle-only：工作区 mcp.json 只写 {"id":"github","enabled":false}。

### 9.3 断言

| # | 输入 | 命令 | 期望（退出码 / 输出） |
|---|---|---|---|
| A1 | fixtures/two-scope | dsh-spec-resolve --fixture fixtures/two-scope --trust true | 0；prompt 键序 base(100)、repo-rules(150)、security(200)；skill=code-review,data-migration；mcp=jira,local-db |
| A2 | 同 A1 | dsh-spec-resolve --fixture fixtures/two-scope --trust true --twice --check-no-io | 0；两次输出逐字节相等；无文件打开记录 |
| A3a | fixtures/locked-profile | dsh-spec-resolve --fixture fixtures/locked-profile --trust true | 0；恰一条 E_LOCKED；security.text = 默认层文本 |
| A3b | fixtures/locked-workspace | dsh-spec-resolve --fixture fixtures/locked-workspace --trust true | 0；恰一条 E_LOCKED；security 仍启用 |
| A3c | fixtures/locked-abuse | dsh-spec-resolve --fixture fixtures/locked-abuse --trust true | 0；恰一条 E_LOCKED；锁定集合不变 |
| A3d | fixtures/locked-disabled | dsh-spec-resolve --fixture fixtures/locked-disabled --trust true | 0；恰一条 E_LOCKED；该键在生效集中不存在（默认层禁用 + 工作区重开被拒） |
| A4 | fixtures/two-scope | dsh-spec-resolve --fixture fixtures/two-scope --trust false | 0；恰两条 W_TRUST；生效集无 data-migration、local-db |
| A5 | 同 A4 与 A1 对比 | 上述两条命令的输出 diff | 0；差异仅为 data-migration 与 local-db 两键及两条 W_TRUST |
| A6 | fixtures/missing-profile | dsh-spec-resolve --fixture fixtures/missing-profile，随后 sha256sum -c before.sha256 | 2；stderr 含 E_PROFILE；哈希校验退出 0（零写入） |
| A7 | fixtures/two-scope | 施加工作区文件后比对全局侧哈希 | 0；$DSH_HOME/profiles 下所有文件哈希不变 |
| A8 | 同 A1 | 连续两次 --apply；第二次后 diff | 0；第二次无文件被写；diff 为空 |
| A9 | fixtures/two-scope | dsh-spec-resolve --fixture fixtures/two-scope --apply --fail-at 2 | 4；apply.json 状态 failed 且 written 列出第 1 个文件；处理后续跑 --apply 得 0 |
| A10 | fixtures/two-scope | 施加成功后重解析每个目标文件并与目标字节比较 | 0；全部相等（I7 的 success 分支） |
| A11 | fixtures/two-scope | 打乱输入数组顺序后重跑 A1 | 0；键序列与 A1 完全相同 |
| A12 | 本文件 | awk '/^## 6[.]/,/^## 7[.]/' docs/next/SPEC.md 后计数下列码 | 0；码表行数 10，去重 10 |
| A13 | 本文件 | test "$(awk '/^## 6[.]/,/^## 7[.]/' docs/next/SPEC.md | grep -cE '^\| [EW]_[A-Z]+ \|')" -eq 10 && test "$(grep -oE '\b[EW]_[A-Z]+\b' docs/next/SPEC.md | sort -u | wc -l)" -eq 10 && echo ok | 0；stdout 为 ok（可直接在仓库根执行） |
| A14 | §3–§8 文本 | ! sed -n '/^## 3[.]/,/^## 9[.]/p' docs/next/SPEC.md | grep -qE 'skill[.]json|"entr[y]"|"locke[d]"[[:space:]]*:' | 0；无输出（旧写法零残留；检测模式用字符类避免自匹配） |
| A15 | fixtures/trust-forged | dsh-spec-resolve --fixture fixtures/trust-forged --trust false | 0；stderr 含 E_PAYLOAD（error/key 不阻断其余键）；data-migration 不生效（伪造 requiresTrust:false 不改变判定） |
| A16 | fixtures/mcp-toggle-only | dsh-spec-resolve --fixture fixtures/mcp-toggle-only --trust true | 0；诊断为空；仅 mcp:github 键被禁用，无 undefined:<id> 一类键 |
| A17 | fixtures/two-scope | dsh-spec-resolve --fixture fixtures/two-scope --missing-seam prompt-hook --apply | 4；stderr 含 E_APPLY 与「prompt 注入钩子」；.dsh/.state/apply.json 不存在；目标文件哈希不变（preflight 未开始，不属 I7 四结局） |

## 10. 附录：本仓教训（教训，非规格）

以下三条来自历史实现的事故，只解释 §5 的约束为何存在；不是功能要求，不得据此扩展规格。

| # | 教训 | 对应约束 |
|---|---|---|
| L1 | shell 端「先删后改名」会在两步之间丢文件：删除成功、改名失败，目标文件消失且备份可能尚未覆盖 | §5.3 禁止 unlink 后 rename，必须使用平台原子替换 |
| L2 | 锁没有心跳会被当成死锁抢占：长任务持锁但无心跳，第二个施加者接管后两者同时写 | §5.4 心跳 5 秒、过期 30 秒、连续两次缺失才接管 |
| L3 | 跨域写会互相覆盖：两个施加器都写同一份文件，后写者覆盖先写者且无冲突提示 | §5.1 每域只写本域文件；协调者不落笔；I4 用哈希验证 |

## 11. 修订记录

本版由 v1（454 行）按 15 条裁决修订；每条裁决都是终局决定。

| 编号 | 裁决 | 处置 | 落点 |
|---|---|---|---|
| T25-01 | §8 偏差 1 事实错误 | 采纳：VS Code 已有 Agent Skills（.github/skills/<name>/SKILL.md，目录名=frontmatter name）；改写为「概念重叠、模型不同」，删除「VS Code 没有 skill」 | §8 偏差 1 |
| T25-02 | §8 偏差 2 事实错误 | 采纳：工作区 MCP 为根 .mcp.json；本规格用 .dsh/mcp.json，偏差改为路径与文件分离的理由 | §8 偏差 2 |
| T25-03 | 信任门可绕过 | 采纳：删除 entry；技能身份只由 id 与目录名决定；requiresTrust 只读 frontmatter，item 声明即 E_PAYLOAD；工作区清单缺失 E_PAYLOAD；加反例 A15 | §3.5、§4.4、A15 |
| T25-04 | 五输入 | 采纳：六输入含 M；M 键集合必须等于 skillsRoot 扫描集合，不一致 E_PAYLOAD | §4.1 |
| T25-05 | Wm 无 kind | 采纳：Ws 用 kind:id，Wm 一律 mcp:<id>；信任门按 key 前缀判 kind；加 A16 | §4.2、A16 |
| T25-06 | 诊断码冲突 | 采纳：E_PAYLOAD 降为 error/key 并丢键续施；E_DUP/E_KIND 只管文件级；仍恰 10 码 | §6 |
| T25-07 | I7 过强 | 采纳：I7 改为「成功=新字节 / 失败=failed+已写清单 / 无混合成功 / partial 显式且下次施加前须处理」 | §7-I7、§5.5 |
| T25-08 | 锁定跨层 | 采纳：由 C1 的 lockedKeys 与 E_LOCKED 解决 | §3.2、§4.4 |
| T25-09 | profile 关联 | 采纳：bindProfile 可提交，激活哪个配置档属用户侧状态 | §8 偏差 5 |
| T25-10 | prompt 与信任门 | 采纳：信任门通用化为 item 级 requiresTrust（mcp 默认 true、skill 取 frontmatter、prompt 默认 false）；偏差 3 补全 Restricted Mode 实际禁用面 | §3.1、§4.4、§8 偏差 3 |
| T25-11 | 宿主物化契约缺失 | 采纳：新增 §5.0，9 项契约，每项给缺失降级与阻塞/降级标记 | §5.0 |
| T25-12 | 验收不可执行 | 采纳：§9 前加术语与 harness 约定；A13 为可直接执行的 shell 断言；A1/A4/A5 使用 data-migration 夹具 | §9.1、§9.3 |
| C1 | 锁定提升为键级属性 | 采纳：lockedKeys 仅默认层；非默认层触碰即 E_LOCKED；I3 全局值=默认+配置档叠加；A3a/A3b/A3c 三条夹具 | §3.2、§4.4、§7、§9 |
| C2 | resolve 六输入、零 IO | 采纳：M 为第六输入；期间零 IO；清单缺失或 frontmatter 非法 → 丢键 + E_PAYLOAD | §4.1、§4.2、§4.4 |
| N1(4) | M 一致性检查顺序 | 采纳：清单校验前移到 enabled 删除之前，禁用技能缺 M 同样 E_PAYLOAD（诊断一致性，不改生效集） | §4.2 |
| C3 | 诊断处置与严重度 | 采纳：E_PAYLOAD=error/key 丢键续施；E_PROFILE 单触发 fatal/workspace；E_APPLY 尽力回滚 + failed 清单 + 修正后可重试 | §6、§5.5 |

## 12. 术语索引

| 术语 | 见 |
|---|---|
| 作用域、配置档、实体、键、覆盖、锁定、信任、技能清单、生效集、施加 | §1 |
| 诊断码、严重度、级别 | §6 |
| 施加器、协调者、宿主物化契约 | §5.0、§5.1 |
| 配置档绑定 | §3.3、§4.4 |
| 六输入、技能清单 M | §4.1 |
