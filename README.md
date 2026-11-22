# 双作用域配置：引入包导读

状态：引入包导读（非规范）。规范文件是 [SPEC.md](SPEC.md)；本文只解释怎么读、按什么顺序落地、怎样验收。读者是未读过本仓历史文档的实现者与评审者。

> 本包自足：读完 `docs/next/README.md`、`docs/next/SPEC.md`、`docs/next/VSCODE-MAPPING.md` 三份文件即可开工，不需要读 `docs/` 下任何旧文档。旧文档只在追溯「为什么这样定」时使用，见 [../README.md](../README.md) 的索引。

## 0. 5 分钟导读

要解决的问题只有一句话：**让提示词、技能、MCP 三类资源在「全局」与「工作区」两个作用域里，用同一套键级覆盖、锁定、信任与施加规则工作。**

现状的三个痛点：

1. 三类资源各有一套控制链，作用域口径不一致；同一个「开关」在不同资源上含义不同。
2. 分组引擎按「全局 / 工作区 / 会话」三层落盘，但会话组对技能与 MCP 没有写能力，模型里出现「看似三层、实际两层半」。
3. 组的 `items` 与 `activeGroupId` 是白名单快照，能表达「这一组启用什么」，但不能表达「这个键被谁覆盖、为什么被拒、失败后现场是什么」。

本方案用四个决定收口：

- **只有两个作用域**：`global` 与 `workspace:<wsid>`；不设第三层。
- **一个键空间**：`prompt:<id>`、`skill:<id>`、`mcp:<id>`；逐键覆盖、诊断、排序都以键为准。
- **两个安全阀**：默认层的 `lockedKeys`（管理者锁定）与 `$DSH_HOME/trust.json`（用户信任）。锁定优先于覆盖；信任门只拦「会触发外部行为」的项。
- **一次施加只写本域**：全局施加器只写 `$DSH_HOME/**`，工作区施加器只写 `<root>/.dsh/**`；原子替换、锁心跳、`apply.json` 五态是硬约束。

五分钟怎么读：

1. 先读本文 §1（三个文件各读什么）与 §3（引入顺序）。
2. 打开 `SPEC.md` 的 §1（名词）、§3（schema）、§4（六输入与伪代码）；这三节是实现的全部输入。
3. 再读 `SPEC.md` 的 §6（10 个诊断码）、§7（7 条不变量）、§9（17 条断言）。
4. 如果来自 VS Code 的配置模型，读 `VSCODE-MAPPING.md` 的对照表与「VS Code 没有的」两节。

## 1. 三个文件怎么读

| 文件 | 性质 | 读它解决什么问题 | 冲突时 |
|---|---|---|---|
| [SPEC.md](SPEC.md) | 规范（唯一权威） | 数据长什么样、`resolve` 怎么算、施加怎么写、失败怎么报、怎样算通过 | 以 SPEC 为准 |
| [README.md](README.md) | 导读（本文） | 先做什么、后做什么、每一步拿什么验收、有哪些已知缺口 | 不覆盖 SPEC |
| [VSCODE-MAPPING.md](VSCODE-MAPPING.md) | 对照（非规范） | VS Code 的哪个概念对应本方案的哪个概念；哪些是刻意偏差 | 以 SPEC 为准 |

三份文件的分工是**规范 / 路径 / 类比**，不是三个版本。不要把 README 里的里程碑当成功能范围，也不要把映射表里的类比当成需求。

## 2. 方案一句话与边界

一句话：**全局提供可复用的默认层与配置档，工作区用同一套 schema 做逐键覆盖；锁定与信任决定「能不能改、能不能执行」；施加器按域隔离并把失败现场写进 `apply.json`。**

边界（不在本包内）：

- 不规定宿主如何发现技能目录、如何注入提示词、如何启动 MCP；这些是 `SPEC.md` §5.0 的宿主物化契约，由宿主实现或由夹具替代。
- 不规定 UI；面板、CLI、编辑器插件都可以是消费者。
- 不规定工期；§4 的里程碑只给可验证产出。
- 不支持多根工作区、语言特定设置、用户侧 profile 自动切换；这些是 SPEC §8 的显式偏差，不是遗漏。

## 3. 引入顺序（每步带验收）

顺序不能倒：schema 未定就无法写夹具；`resolve` 未纯化就无法测确定性；施加器未原子化就无法测失败恢复；信任门与诊断码是横切面，最后收口；迁移/导出是宿主侧一次性工具，不进入核心算法。

### 3.1 第一步：两层文件与 Schema

产出：

- 四个文件形态：`$DSH_HOME/profiles/default.json`、`$DSH_HOME/profiles/<name>.json`、`<root>/.dsh/settings.json`、`<root>/.dsh/mcp.json`；技能声明是 `<skillsRoot>/<id>/SKILL.md`。
- 解析与校验：`schema` 必须为整数 1；`kind` 只能是 `prompt` / `skill` / `mcp`；id 匹配 `^[a-z][a-z0-9-]{1,63}$`；未知字段、重复键、错误文件分工分别报 `E_SCHEMA` / `E_PARSE` / `E_DUP` / `E_KIND` / `E_PAYLOAD`。
- 技能身份只由「目录名 = id = frontmatter name」决定；item 不携带路径；`requiresTrust` 只能来自 frontmatter。

验收：

- 用 `SPEC.md` §3.7 的完整示例手工构造 `fixtures/two-scope`；四个 JSON 与三个 `SKILL.md` 都能被解析器接受。
- 对每个错误字段各写一个反例，断言诊断码与「丢键还是拒绝文件」符合 §6。
- 跑 §9.3 的 A14：旧写法（`skill.json`、`entry`、`locked` 字段）零残留。

### 3.2 第二步：生效算法 `resolve`

产出：

- 六输入 `D` / `P` / `Ws` / `Wm` / `trust` / `M`；`resolve` 期间零 IO，不读时钟、环境变量、随机数。
- 覆盖顺序固定为 默认层 → 配置档 → 工作区；锁定键在非默认层出现即 `E_LOCKED`，键保留全局值。
- 技能清单一致性检查必须在 `enabled:false` 删除之前；`M` 缺键或 frontmatter 非法时丢该技能键并报 `E_PAYLOAD`。
- 输出按 kind 升序、prompt 按 `(order, id)`、skill/mcp 按 id 字节序排序；排序与输入数组顺序无关。

验收：

- A1：`fixtures/two-scope --trust true` 的键序与 §4.5 手算表一致。
- A2：`--twice --check-no-io` 两次输出逐字节相等，且无文件打开记录。
- A11：打乱输入数组顺序后键序列与 A1 完全相同。
- A3a–A3d：配置档覆盖、工作区禁用、非默认层伪造 `lockedKeys`、默认层禁用后工作区重开，四种锁定路径各恰一条 `E_LOCKED`。

### 3.3 第三步：施加器与恢复

产出：

- preflight：`SPEC.md` §5.0 的九项宿主契约逐项检查；任一「阻塞」项缺失，零写入、不创建 `apply.json`、返回 `E_APPLY` 并携带契约项名。
- 写入：规范 JSON 字节（2 空格缩进、LF、固定键序、末尾一个换行）；逐文件 diff，相同则跳过；临时文件 → 落盘 → 原子替换。禁止先删除目标再改名。
- 锁：每域一把锁，`heartbeatAt` 每 5 秒更新，`expiresAt = heartbeatAt + 30 秒`；只有过期且连续两次心跳缺失才允许接管并写审计。
- `apply.json` 五态：`writing` / `committed` / `rolled-back` / `failed` / `partial`；`partial` 存在时下一次施加前必须先处理。

验收：

- A6：`bindProfile` 指向缺失文件时退出码 2、stderr 含 `E_PROFILE`、目标文件哈希不变（零写入）。
- A7：施加工作区后 `$DSH_HOME/profiles` 下所有文件哈希不变（域写隔离）。
- A8：连续两次 `--apply`，第二次无文件被写、diff 为空（幂等）。
- A9：`--fail-at 2` 后 `apply.json=failed` 且 `written` 列出已写文件；处理后重跑成功。
- A10：施加成功后重解析每个目标文件，字节与目标一致（I7 的 success 分支）。
- A17：`--missing-seam prompt-hook` 时退出码 4、stderr 含 `E_APPLY` 与契约项名、`apply.json` 不存在、目标文件哈希不变。

### 3.4 第四步：信任门

产出：

- `$DSH_HOME/trust.json` 只存用户信任的绝对路径；信任写入是用户动作，不经过施加器。
- 未信任工作区中，只有 `origin=workspace` 且 `requiresTrust` 的键被丢弃：mcp 默认 true、skill 取 frontmatter、prompt 默认 false；全局层与配置档层视为可信。
- 每丢一个键恰一条 `W_TRUST`；技能 item 伪造 `requiresTrust:false` 必须报 `E_PAYLOAD`，不能改变判定。

验收：

- A4：未信任时恰两条 `W_TRUST`，`data-migration` 与 `local-db` 不生效。
- A5：信任/未信任两次输出 diff 只包含这两个键与两条 `W_TRUST`。
- A15：`fixtures/trust-forged` 在未信任下报 `E_PAYLOAD`，`data-migration` 仍不生效。
- A16：`fixtures/mcp-toggle-only` 诊断为空，只禁用 `mcp:github`，不产生 `undefined:<id>` 一类键。

### 3.5 第五步：诊断码与错误处置

产出：

- 恰好 10 个码：`E_SCHEMA`、`E_PARSE`、`E_DUP`、`E_KIND`、`E_PAYLOAD`、`E_LOCKED`、`E_PROFILE`、`E_APPLY`、`W_TRUST`、`W_TOOL`；新增能力前先合并旧码，禁止第 11 个。
- 严重度与级别固定：fatal 不给结果，error 只丢该键，warn 只提示；`E_PAYLOAD` 永远「丢键、续施」，不存在整份文件不可施加。
- 每个码只有一个触发口径；`E_DUP` / `E_KIND` 负责文件整体不可信，`E_PAYLOAD` 负责单键声明违规，二者不重叠。

验收：

- A12：§6 码表行数 10、去重 10。
- A13：仓库根可直接执行的 shell 断言输出 `ok`。
- 每个 fatal 码各一个夹具；`E_PROFILE` 只由 `bindProfile` 单触发；`E_APPLY` 区分 preflight（不创建 `apply.json`）与 writing 之后（五态之一）。

### 3.6 第六步：迁移与导出（宿主侧，一次性）

产出：

- 一个一次性工具：把旧版 `dsh-context-manager` 的组/层配置转换为新的 `default.json` / 配置档 / 工作区 `settings.json` / `mcp.json` / `SKILL.md`；导出方向相反。
- 转换只做数据搬运，不把旧语义带进新文件：旧「组 items 白名单」不再有运行时含义；旧「三作用域」中的会话层不迁移；旧「遮蔽/deny」不写成新 schema 字段。
- 迁移产物必须能被 §3 解析；导入后跑 A1/A2 作为验收，不要求与旧版行为逐字节相同。

验收：

- 每个旧配置文件都有对应的转换夹具；转换后再解析，诊断为空或只剩可解释的 `W_TRUST`。
- 导出后再导入，键集合与顺序稳定（允许显示名不同，不允许 id 改变）。
- 迁移工具本身不写 `$DSH_HOME/.state` 之外的文件；失败时不留下半态。

## 4. 里程碑 M0–M3（只给可验证产出，不给工期）

| 里程碑 | 可验证产出 | 通过条件 |
|---|---|---|
| M0 规范可执行 | `fixtures/` 六个夹具 + 一个最小 harness 骨架；A12/A13/A14 可跑 | 码表 10 条、旧写法零残留、夹具能被解析 |
| M1 纯函数生效集 | `resolve` 六输入实现 + 诊断对象；A1/A2/A3a–A3d/A4/A5/A11/A15/A16 | 两次调用逐字节相等、零 IO、键序与手算表一致 |
| M2 施加与恢复 | 域隔离施加器、原子替换、锁心跳、`apply.json` 五态；A6–A10/A17 | 失败可回滚或显式 partial；第二次施加 diff 为空；跨域哈希不变 |
| M3 迁移与交付 | 一次性迁移/导出工具、旧夹具、文档索引；全量回归 | A1–A17 全绿；迁移产物可被 §3 解析；无旧语义字段 |

里程碑之间不允许「先做 UI 再补算法」：UI 只能消费 M1/M2 的输出，不能反向定义生效集。

## 5. 验收 checklist

实现自检时逐项打勾；任何一项不满足都不要声称「已按规格实现」。

- [ ] 全仓只有两个作用域名：`global` 与 `workspace:<wsid>`；没有会话层、没有第三层。
- [ ] 所有实体身份都是 `kind:id`；显示名不参与引用、定位、选择、deny、resolve、审计。
- [ ] `schema` 只接受整数 1；未知字段、重复键、错误 kind 各有对应诊断。
- [ ] `lockedKeys` 只允许出现在默认层；任何非默认层出现即 `E_LOCKED`。
- [ ] 覆盖是整值替换，不做字段合并；工作区未覆盖的键沿用全局值。
- [ ] `resolve` 只读六输入，期间零 IO、零时钟、零随机、零环境变量。
- [ ] 清单一致性检查在 `enabled:false` 删除之前；技能 item 不携带路径，`requiresTrust` 只读 frontmatter。
- [ ] 信任门只拦 `origin=workspace` 且 `requiresTrust` 的键；全局/配置档视为可信。
- [ ] 诊断码恰好 10 个；`E_PAYLOAD` 丢键续施；`E_PROFILE` 只由 `bindProfile` 触发。
- [ ] `apply.json` 只有五个状态；`partial` 未处理时下一次施加被拒绝。
- [ ] 原子替换使用平台原语；没有 `unlink(target)` 后 `rename` 的路径。
- [ ] 锁有 5 秒心跳、30 秒过期、连续两次缺失才接管；接管写审计。
- [ ] 一次施加只改本域文件；对照域哈希不变（I4）。
- [ ] A1–A17 全部可执行并通过；A2 的零 IO 有可观察证据，不只口头声明。
- [ ] 迁移/导出产物能被 §3 解析；没有把旧组语义写进新字段。
- [ ] 文档中的每个链接都能解析；SPEC 与 README 的规范/导读边界没有被混用。

## 6. 三条本仓教训（教训，非规格）

| # | 教训 | 为什么写进规格 |
|---|---|---|
| L1 | shell 端「先删后改名」会在删除成功、改名失败之间丢文件；备份可能还没覆盖 | SPEC §5.3 禁止 `unlink` 后 `rename`，要求临时文件 → 落盘 → 原子替换 |
| L2 | 锁没有心跳会被当成死锁抢占；长任务持锁时第二个施加者接管，两者同时写 | SPEC §5.4 固定心跳 5 秒、过期 30 秒、连续两次缺失才接管 |
| L3 | 两个施加器都写同一份文件，后写者覆盖先写者且无冲突提示 | SPEC §5.1 每域只写本域；协调者不落笔；I4 用哈希验证 |

这三条只解释约束为什么存在，不是功能需求；不要据此扩展规格。

## 7. 已知缺口

1. **评审 N1（medium，非阻断）的残余**：SPEC §4.1 要求 `M` 键集合等于 skillsRoot 扫描集合（含任何层 `enabled:false` 的技能），但 `resolve` 只能检查进入 `named` 的已声明技能键；未被任何层声明的技能目录若在 `M` 中缺失，算法没有独立输入去发现。当前 §4.2 已把已声明技能的 `M` 校验放在 `enabled:false` 删除之前（§11 N1(4) 记录），所以「禁用技能缺 `M` 不报错」按现文不成立；残余是 `M` 全集完整性仍需宿主/夹具保证。评审记录的字面描述与当前顺序不一致，本文按 SPEC 现状记录，不隐藏差异。
2. **宿主物化契约没有参考实现**：§5.0 的九项（profiles root、两个 skillsRoot、trust store、prompt 注入、skill allowlist、mcp 启停、原子替换、清单快照）必须由宿主或夹具提供；阻塞项缺失时规格要求拒绝施加，不能静默降级。
3. **迁移/导出工具不在 SPEC 核心算法内**：§3.6 只给宿主侧验收建议；旧版组/层配置的字段映射需要实现者补一张映射表，本文不替它做技术决定。
4. **显式不支持的面**：多根工作区、语言特定设置、用户侧 profile 自动切换（SPEC §8 偏差 4/5/7）。需要这些能力时应另开规格，不要在本包上打补丁。
5. **没有工期与人力承诺**：本文只给里程碑与可验证产出；任何日期、人日、优先级都不在本包内。
6. **旧文档仍可能被误读**：`docs/clean-scope-model.md`、`docs/two-scope-grouping-proposal.md`、`docs/control-grouping-current-state.md` 记录的是设计演进与现状，不是本包的实现依据；索引见 [../README.md](../README.md)。

## 8. 本包边界

- 本包是**规范 + 导读 + 对照**，不是实现，也不是发布说明。
- 任何实现若与 SPEC 冲突，以 SPEC 为准；若要改 SPEC，先改规范再改实现，不能反过来用实现倒推规范。
- 本包不引用 `src/` 的行号作为规范依据；旧实现的证据只用于解释偏差，见 `docs/control-grouping-current-state.md` 与 `docs/surveys/`。
