# VS Code 概念对照（非规范）

状态：对照文档，不是规范。规范是 [SPEC.md](SPEC.md)；本文只做概念映射，任何冲突以 SPEC 为准。读者是熟悉 VS Code 设置/配置档/工作区信任，想快速判断「这个方案像不像 VS Code」的实现者。

## 0. 一句话结论

本方案用 VS Code 的「最近者胜 + 文件化配置」直觉，换来可预测的全局/工作区两级覆盖、单一文件面和不需要注册表的实现；代价是放弃 VS Code 的多根、语言特定设置与自动 profile 关联，且不提供谱系保证——安全性由 `lockedKeys` 与 `trust.json` 承担，而不是由目录结构承担。

## 1. 怎么读这张表

- 「相同点」只写机制层面的相似，不写 UI 相似；本方案没有 VS Code 的设置编辑器。
- 「偏差与理由」是刻意选择，不是待补功能；需要补的功能见 SPEC §8 的显式偏差。
- 「依据」优先指 SPEC 的规范条款；VS Code 事实的官方链接集中在 §4，表内用方括号编号引用。
- VS Code 的事实按官方文档口径写；本方案的事实按 SPEC 口径写。两边不互相证明。

## 2. 概念对照表

| # | VS Code 概念 | 本方案概念 | 相同点 | 偏差与理由 | 依据 |
|---|---|---|---|---|---|
| 1 | User Settings 与 Workspace Settings 两级作用域，工作区覆盖用户 | 全局（默认层 + 配置档）与工作区两级；工作区逐键覆盖 | 都是「近者胜」：工作区值压过全局值；未覆盖的键沿用全局 | 只有两个作用域；没有 Folder Settings 与语言特定层；覆盖是整值替换，不做字段合并 | SPEC §3.3、§4.4、§8 偏差 6/7；[1] |
| 2 | Application 级设置：用户和工作区都不能覆盖 | 默认层 `lockedKeys`：非默认层以同一键声明即 `E_LOCKED` | 都提供一个「管理者钉住、普通配置改不动」的层 | VS Code 是固定清单；本方案是数据字段，可由管理员按组织策略下发；必须校验它只出现在默认层 | SPEC §3.2、§4.4、§8 偏差 8；[1] |
| 3 | Profiles：一组命名设置，可在用户侧切换/关联文件夹 | 配置档：`$DSH_HOME/profiles/<name>.json`；工作区用 `bindProfile` 选用一份 | 都是命名配置集合；都可以作为团队基线复用 | VS Code 的 profile 与文件夹关联属用户侧持久状态；本方案把 `bindProfile` 写进工作区文件、可提交，团队共享同一个绑定，没有「打开文件夹即切档」 | SPEC §3.3、§8 偏差 5；[2] |
| 4 | Workspace Trust / Restricted Mode：未信任工作区限制外部行为 | `$DSH_HOME/trust.json` + 逐键信任门（`requiresTrust`） | 都按「这个根是否可信」决定是否允许有外部影响的配置生效 | VS Code 还限制 AI agents、terminal、tasks、debugging、workspace settings 与未声明支持信任的扩展；本方案只覆盖三类资源中会触发外部行为的项（mcp 默认 true、skill 取 frontmatter、prompt 显式 opt-in） | SPEC §3.6、§8 偏差 3；[3] |
| 5 | Multi-root Workspaces：`.code-workspace` 的 `folders` 可包含多个根 | 单根：每个项目根各自一份 `<root>/.dsh/` | 都允许一个窗口里处理多个项目 | 本方案不定义「哪个根持有配置」；多根需要每根一份配置，或等待后续规格。这是显式偏差，不是遗漏 | SPEC §2.2、§8 偏差 4；[4] |
| 6 | `.vscode/settings.json`：工作区级、可提交 | `<root>/.dsh/settings.json`：工作区级、必须入库 | 都是「把项目意图写进仓库」的文件面 | 路径与 schema 不同；本方案把 prompt/skill 的覆盖、新增、禁用放在一个文件，mcp 另放 `mcp.json` | SPEC §2.2、§3.3 |
| 7 | 工作区根 `.mcp.json`：工作区级 MCP 配置 | `<root>/.dsh/mcp.json`：工作区级 MCP 配置 | 都是工作区文件，按文件做信任与 diff | 路径不同；本方案的 MCP 项有独立 `requiresTrust` 默认 true 与 `tools.deny`；不与 VS Code 共享一份文件 | SPEC §3.4、§8 偏差 2 |
| 8 | Agent Skills：`.github/skills/<name>/SKILL.md`，目录名必须等于 frontmatter name | `<skillsRoot>/<id>/SKILL.md`，目录名 = id = frontmatter name | 技能都是「目录 + SKILL.md + frontmatter」，身份由目录名决定 | 路径不同；VS Code 的 skill 不做本方案的作用域分组、锁定、信任门；本方案把 skill 当成可覆盖/可锁定的资源项，而不是只做发现 | SPEC §3.5、§8 偏差 1 |
| 9 | 设置文件的 JSONC：允许注释与尾逗号 | 严格 JSON：UTF-8 无 BOM，禁止注释与尾逗号 | 都是人可编辑的配置文件 | 本方案用严格 JSON 换取可规范序列化、可逐字节 diff、可哈希校验；解析失败是 `E_PARSE` | SPEC §3.1、§5.2 |
| 10 | Trust 提示按工作区根出现，信任状态由用户选择 | `$DSH_HOME/trust.json` 的 `trustedRoots`：绝对路径、realpath 归一 | 都是「用户对某个根做一次信任决定」 | 信任状态只存用户目录，禁止写进工作区（不能随仓库分发）；路径按平台大小写规则归一 | SPEC §3.6 |
| 11 | Profile 与文件夹的关联是用户侧状态，工作区不能提交该选择 | `bindProfile` 写在工作区 `settings.json`，可提交 | 都在工作区层表达「用哪套配置」 | 本方案把选择降为仓库资产，团队共享同一基线；个人偏好用逐键覆盖表达，不能在不改工作区文件时临时切档 | SPEC §3.3、§8 偏差 5；[2] |
| 12 | 语言特定设置：`[language]` 可压过非语言特定的工作区设置 | 没有语言维度；prompt 只有 `order`，skill/mcp 只有 id | 都试图让「更具体的配置」赢 | 三类资源里只有 prompt 有序；多语言仓库只能建多个配置档。这是刻意不支持，不是待办 | SPEC §8 偏差 7；[1] |
| 13 | 工作区信任会影响扩展、终端、任务、调试等 | 信任门只影响三类资源的可执行性 | 都遵循「未信任就不执行外部行为」 | 本产品只有 prompt/skill/mcp；prompt 是惰性文本，默认不拦；团队若在提示词里塞命令，需要评审或把该键加入 `lockedKeys` | SPEC §8 偏差 3；[3] |

### 2.1 最容易误读的三组对照

**设置作用域 vs 两个作用域。** VS Code 有 User、Workspace、Folder 与语言特定设置；本方案只有全局与工作区。不要把 VS Code 的 Folder Settings 直接映射成「工作区」：本方案的「工作区」就是项目根，没有「同一个窗口里第二个根」的层级。也不要指望用语言特定设置表达多语言仓库；那需要多个配置档。

**Application 级设置 vs `lockedKeys`。** VS Code 的 application 级设置是一份固定的、用户与工作区都不能覆盖的清单；本方案的 `lockedKeys` 是默认层里的数据字段，管理员可以按组织策略增删。它不是「把文件设成只读」：文件仍可编辑，但非默认层以同一键声明会被 `E_LOCKED` 拒绝，键保留全局值。

**Workspace Trust vs `trust.json`。** VS Code 的信任决定会影响扩展、终端、任务、调试等一大片能力；本方案的信任门只拦「会触发外部行为」的三类资源项。信任不是沙箱，也不证明配置安全：它只决定「未信任时这个键是否生效」。把危险命令写进 prompt 仍然不会被执行，但会被注入模型；需要更强保证时用 `lockedKeys` 或评审。

### 2.2 本表没有覆盖的 VS Code 面

以下 VS Code 能力不在本方案范围，也不应被这张表暗示为「已对齐」：设置同步、扩展推荐、任务与调试配置、终端 profile、键绑定、代码片段、工作区文件夹（multi-root）、语言特定设置。它们要么不属于 prompt/skill/mcp 三类资源，要么被 SPEC §8 明确列为不支持。

## 3. VS Code 没有的（以及任务书旧说法的冲突）

### 3.1 「VS Code 没有 skill 概念」是旧说法，按 SPEC 修正

任务书原要求写「VS Code 没有的：skill 概念」。这与 SPEC §8 偏差 1 以及 VS Code 的 Agent Skills 事实冲突：**VS Code 有 Agent Skills**（`.github/skills/<name>/SKILL.md`，目录名必须等于 frontmatter name）。本文不沿用旧说法。

真正没有的是：**把 skill 当作与 prompt、mcp 同级的可覆盖/可锁定/可统一分组的资源项**。VS Code 的 skill 是发现与加载机制，不是「逐键覆盖 + 锁定 + 信任门 + 统一分组」的配置模型。这个区别是本方案的核心增量，不是文字游戏。

### 3.2 没有「三类资源统一分组」

VS Code 分别管理设置、Agent Skills、MCP 服务器；它们没有共享的 `kind:id` 键空间，没有同一份 `extends` / `deny` / `lockedKeys`，也没有「一个工作区绑定一份全局配置档」的统一入口。本方案把三类资源收进同一 schema、同一套覆盖与锁定规则、同一组诊断码，这是与 VS Code 最大的结构差异。

### 3.3 没有「不依赖注册表的最近者胜」

VS Code 的很多行为依赖扩展注册、语言服务与工作区文件夹模型；本方案把生效集定义成六输入的纯函数，不读注册表、不做发现、不在 resolve 期间 IO。换来的是可手算、可逐字节断言；代价是没有 VS Code 那样成熟的扩展生态与文件夹继承。

### 3.4 「没有」不等于「只有两个差异」

§3.1 与 §3.2 说的是**结构缺口**：VS Code 有 skill，但没有把 skill 纳入统一分组；VS Code 有三类资源，但没有共享的键空间与锁定模型。它们不是「VS Code 没有的东西」的全部清单。VS Code 还有多根工作区、语言特定设置、用户侧 profile 关联，这些本方案也没有；区别是这些在 SPEC §8 里是**显式偏差**（VS Code 有、我们刻意不做），而 §3.1/§3.2 是**模型差异**（VS Code 有相邻能力、但没有这个组合）。两类都要如实写，不能把「我们不做」包装成「VS Code 没有」。

## 4. 官方链接（VS Code 事实）

| 编号 | 主题 | 官方链接 | 本文用它支持什么 |
|---|---|---|---|
| [1] | 用户/工作区设置与覆盖规则、application 级设置 | https://code.visualstudio.com/docs/configure/settings | 表 1、2、9、12 的「作用域/覆盖/JSONC/语言特定设置」事实 |
| [2] | Profiles（配置档）与文件夹关联 | https://code.visualstudio.com/docs/configure/profiles | 表 3、11 的「命名配置集合、用户侧关联」事实 |
| [3] | Workspace Trust / Restricted Mode | https://code.visualstudio.com/docs/editing/workspaces/workspace-trust | 表 4、13 的「未信任工作区限制面」事实 |
| [4] | Multi-root Workspaces | https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces | 表 5 的「.code-workspace folders」事实 |

说明：Agent Skills 与工作区 `.mcp.json` 的事实按 SPEC §8 偏差 1/2 的口径写；本文不把未在本仓核实过的 Copilot 文档 URL 写成官方链接，避免给出会失效的地址。需要补链接时，应先核对 VS Code 官方 Copilot customization 文档，再更新本表。

### 4.1 迁移场景：三种读者

**个人用户。** 把你现有的全局设置整理成 `$DSH_HOME/profiles/default.json` 与一份命名配置档；不要整份复制 VS Code 的 `settings.json`，只挑 prompt/skill/mcp 三类资源。原来靠语言特定设置做的偏好，改成多个配置档，由工作区 `bindProfile` 选择。

**团队仓库。** 提交 `<root>/.dsh/settings.json`、`<root>/.dsh/mcp.json` 与 `<root>/.dsh/skills/`；把团队基线写进全局默认层或共享配置档；把不可协商的键放进 `lockedKeys`。不要提交 `$DSH_HOME/trust.json` 或 `<root>/.dsh/.state/`：前者是个人安全决定，后者是机器状态。

**未信任的克隆。** 第一次打开时 `trust=false`：工作区声明的 mcp、requiresTrust 技能、显式 opt-in 的 prompt 不生效，分别产生 `W_TRUST`；全局层与配置档层不受影响。用户确认信任后重跑，生效集才包含这些键。不要把「未信任时还能看到配置」误读成「未信任也能执行」。

### 4.2 事实核对清单

- [ ] 官方链接可打开，且页面主题与表中「用它支持什么」一致。
- [ ] 表中的 VS Code 事实没有超出官方文档；不确定的写成「未核实」，不写成断言。
- [ ] 本方案的事实能在 SPEC 找到条款；找不到就不要写进本表。
- [ ] 没有把 SPEC §8 的显式偏差改写成「VS Code 没有」。
- [ ] 没有把旧实现的 `src/` 行号当作 VS Code 或新方案的证据。
- [ ] 官方文档更新后，先改本表与 SPEC §8，再改实现或夹具。

### 4.3 官方链接的使用规则

链接是证据，不是权威。SPEC 是本方案唯一的规范；VS Code 文档只用来支撑「VS Code 是这样」的事实。中文页面可能滞后于英文页面，优先引用英文 canonical URL；如果链接失效，保留主题描述并标注「待补链接」，不要用二手博客替代官方文档。

### 4.4 三个反例：这张表最容易被误用的地方

**反例一：把「最近者胜」当成「所有设置都能覆盖」。** 锁定键、信任门、文件级 fatal 都会打断覆盖链；工作区写了值不等于生效。看到 `E_LOCKED` 或 `W_TRUST` 时，先看诊断，不要先怀疑覆盖顺序。

**反例二：把 VS Code 的 profile 关联当成 `bindProfile`。** VS Code 的关联在用户侧，换机器可能丢；本方案的 `bindProfile` 在工作区文件里，换机器跟着仓库走。前者适合个人偏好，后者适合团队基线，不能互换。

**反例三：把「未信任」当成「只读模式」。** 未信任时工作区配置仍可读、prompt 仍可生效；被拦的是会触发外部行为的键。把未信任当成只读会低估风险：只读的 prompt 也可能包含敏感指令。

## 5.
## 5. 结论

**换来的**：可预测的最近者胜（工作区覆盖全局、锁定键不可触碰）、单一文件面（每域只写自己的文件）、不需要注册表（resolve 是六输入纯函数）、跨域写隔离与可恢复的施加。

**代价**：没有 VS Code 的多根/语言特定/自动 profile 关联；没有「扩展生态自动发现」；没有谱系保证——锁只能保护被声明的键，信任只能拦会触发外部行为的项，二者都不能证明「这个工作区为什么变成现在这样」。需要谱系时，应另做 provenance/审计，而不是在本方案上假装有。

### 5.1 术语速查

| VS Code 词 | 本方案词 | 一句话 |
|---|---|---|
| User / Workspace Settings | 全局 / 工作区 | 两级作用域，近者胜 |
| Application Settings | `lockedKeys` | 管理者钉住，非默认层改不动 |
| Profile | 配置档 | 命名的全局配置集合，由 `bindProfile` 选用 |
| Workspace Trust | 信任门 | 未信任时拦会触发外部行为的键 |
| Folder | 项目根 | 本方案不区分窗口内多个根 |
| Extension | 宿主能力 / 宿主物化契约 | 本方案不靠扩展注册，靠 §5.0 契约 |
| Settings Sync | 无对应 | 本方案不定义同步 |
| Language-specific Settings | 无对应 | 用多个配置档替代 |

## 6. 评审时最常问的五个问题

**1. 为什么只有两个作用域？** 因为第三层（会话）在旧实现里对技能与 MCP 没有写能力，保留它会让模型出现「看似三层、实际两层半」。两个作用域是干净模型的硬边界；需要临时变化时用工作区覆盖或配置档，不新增层。

**2. 为什么锁定不能由工作区写？** 锁定是管理者对键的约束，不是工作区偏好。允许工作区声明 `lockedKeys` 会让「被锁」变成可自证；因此非默认层出现即 `E_LOCKED`，且该声明被忽略。

**3. 为什么信任门不拦 prompt？** prompt 是惰性文本，不会直接触发外部行为；把它默认拦掉会让未信任工作区连只读提示词都用不了。团队若在提示词里写命令，应靠评审或把键加入 `lockedKeys`，而不是假装信任门能执行沙箱。

**4. 为什么不用 VS Code 的 `.github/skills` 路径？** 路径是产品选择，不是事实判断。VS Code 的发现机制可以借鉴；本方案需要把 skill 与 prompt/mcp 放进同一键空间、同一锁定与信任模型，因此用自己的 `.dsh/skills`，并在 SPEC §8 偏差 1 说明不能直接复用其发现流程。

**5. 为什么没有多根工作区？** 多根会引入「哪个根持有配置」的额外模型；本方案面向单根仓库，每个根一份配置。需要多根时另开规格，不要在 `.code-workspace` 上打补丁。

### 6.1 版本与维护

本表跟着 `SPEC.md` 的版本走；SPEC 改 §8 偏差时，本表必须同步改对应行。VS Code 官方文档更新时，先核对链接与事实，再决定是否改 SPEC；不能为了对齐 VS Code 而悄悄改规范。

维护者检查顺序：先跑本表 §4.2 的清单，再检查 §2 的 13 行是否每行都有「相同点 / 偏差 / 依据」，最后检查 §3 的两个结构缺口是否仍与 SPEC §8 偏差 1/2 一致。

### 6.2 发现冲突时怎么报告

如果发现本表与 SPEC、或与 VS Code 官方文档冲突，按「事实 → 条款 → 建议」三行报告：第一行写可复核的官方事实与链接；第二行写 SPEC 的对应条款与当前措辞；第三行写建议改哪一份、为什么。不要只写「感觉不对」，也不要用旧实现的行号替代官方事实。

冲突未解决前，以 SPEC 为准执行；本表的错误单独修正，不阻塞实现。

## 7. 与 SPEC 的边界

- 本文不是需求，不新增功能；表里的「偏差」是 SPEC §8 已经承认的代价。
- 本文不引用旧实现的 `src/` 行号；旧实现的事实见 `docs/control-grouping-current-state.md` 与 `docs/surveys/`，只用于解释为什么会有这些偏差。
- 若 VS Code 官方文档更新，先改本表 §4 的链接与事实，再检查 SPEC §8 是否需要同步；不要反过来用本表覆盖 SPEC。
