# 技能与提示词：作用域、继承与启停

本文说明 dsh-csmm 里“定义放在哪、配置集管什么、开关到底关了什么”，重点解释**技能启停**和**提示词过滤**的区别。安装、存储布局和 RPC 细节以 [README.md](../README.md) 为准。

## 1. 先分清三层

| 层 | 回答的问题 | 主要数据 |
|---|---|---|
| 定义层 | 这个资源属于全局还是某个工作区 | store.json 里的 skills / servers / customs 等记录 |
| 配置集层 | 当前作用域选哪一组资源生效 | groups、activeGroup |
| 开关层 | 这个资源自己是否启用 | disabledPrompts、SkillRecord.enabled、skillPolicy |

三层不是互相替代的关系：

- 配置集勾选 + 资源开关关闭：资源仍然不生效，关闭优先。
- 配置集未勾选 + 资源开关打开：插件自有资源仍不会注入；配置集是白名单。
- DSH 注册表技能不参与配置集勾选，只受自己的作用域策略控制。

## 2. 提示词

### 2.1 提示词的来源

- 插件自有提示词段：全局 home 下 sections/**/*.md，一个文件对应一个 section。
- DSH 注册提示词：由宿主注册，插件在提示词页按名字列出，并按配置集过滤。
- 自定义提示词：按作用域保存在 store 的 customs 中，可逐条启用/停用。
- 运行上下文：始终注入，不参与配置集，也不受普通段开关影响。
- 工具定义：不是提示词段。工具 schema 由工具注册表单独下发，配置集通过 tools.restrict 另做白名单。

提示词页中栏只读全文；成员写入统一在「配置集与生效」页完成。

### 2.2 作用域与配置集继承

- 作用域只有 global 与 workspace，没有会话层。
- 工作区只有被信任时才进入可见链；未信任时只取全局。
- activeGroup 的键缺失：继承下一层。
- activeGroup 的值为空字符串：显式“不使用配置集”，阻断继承。
- activeGroup 有 id：该配置集生效；空配置集也是真实生效的一层。
- 三层都没有生效配置集：不过滤，提示词段和工具都保持原样。
- 有生效配置集：按白名单过滤。
  - 提示词段：勾选的才放行，未勾选的被过滤。
  - 工具：勾选的才放行；一个都不勾选就是拒绝全部工具。
  - contexts 和 dsh-csmm:* 始终保留；run_code 由宿主保留，不能靠白名单重新打开。
- disabledPrompts：全局与工作区的禁用名单取并集，禁用永远优先。工作区不能把全局已禁用的段重新打开。
- 自定义提示词跟随生效配置集所属的作用域；只渲染该作用域内 enabled 不为 false 的记录，不把全局和工作区两份正文合并。

### 2.3 生效时间

- 提示词段过滤在每次 system-prompt 装配时重新计算，已提交的改动下一轮装配可见（通常就是下一轮对话）。
- 工具白名单在创建 agent 时调用 tools.restrict，只对之后新建的 agent 生效（新会话、子代理）。
- 已经装配进当前轮次的提示词不会因为本轮中途保存而重写。

## 3. 技能

### 3.1 两类技能

**插件自有技能**（SkillRecord）：

- 保存在插件 store，按 global / workspace 分开。
- 工作区同名技能覆盖全局。
- 只有进入生效配置集的技能才会注册进宿主；SkillRecord.enabled 为 false 时跳过。
- 注册时 source / provider 都是 dsh-csmm。
- 改动在下次创建 agent 时生效。

**DSH 注册表技能**（ctx.skills）：

- 由宿主发现和裁决，插件只读目录、按需读正文。
- 插件读取目录时带上默认 agent preset 的 view scope；这样挂在 preset 层 filesystem 的 user-agents / project-agents 来源也能显示，只传 cwd 只会读到全局层。
- 不参与配置集勾选；配置集勾选管不到它们。
- 同名裁决由宿主注册表完成，插件不合并正文、不重新排序。
- 插件只额外保存“当前作用域是否停用”的策略。

### 3.2 根优先级

插件把宿主返回的 source 映射成以下顺序，用于展示和策略键：

| 顺序 | source | 含义 |
|---|---|---|
| 1 | project-dsh | 项目 .dsh 技能 |
| 2 | project-agents | 项目 .agents 技能 |
| 3 | custom | 自定义来源（由宿主提供方定义） |
| 4 | user-dsh | 用户 .dsh 技能 |
| 5 | user-agents | 用户 .agents 技能 |
| 6 | bundled | 随宿主打包的技能 |

runtime 和 dsh-csmm:off 是插件运行时层，不在这张用户来源表里。

需要区分“显示顺序”和“实际裁决”：

- 同名 winner 由 DSH 注册表按自己的层与 rank 选出；project 同名通常胜出。
- 插件拿到的是已经裁决后的 list，不会把被遮蔽的低优先级条目重新显示出来。
- custom 只是 source 标签，实际 rank 由宿主提供方决定；不能只凭 source 断言运行时遮蔽一定压得住它。

### 3.3 作用域策略

skillPolicy 记录形如：

    { name, source, scope, cwd?, state: 'on' | 'off' }

- inherit 不是第三种持久状态；选择“继承”会删除本层记录，回落到全局或默认。
- 解析顺序：工作区本层记录（scope.id 匹配，cwd 匹配；记录没有 cwd 视为通配）优先，其次全局记录，最后默认 on。
- 工作区显式 on 能覆盖全局 off；工作区显式 off 能覆盖全局 on；工作区选择继承则继续看全局。
- 全局 off 会被所有工作区继承；某个工作区 on 只打开该工作区。
- 策略只写插件 store，不改 DSH 源文件。
- 策略与配置集正交：它不会把技能加进配置集，也不会改变插件技能的组勾选。

### 3.4 “关闭”到底做了什么

关闭不是删除技能，也不是改写源文件。下一次创建 agent 时：

1. 插件读取当前作用域解析出的 off 记录。
2. 如果宿主目录里确实存在同名、同 source、且允许停用的技能，就注册一个同名运行时影子。
3. 影子的 invocation 是 modelInvocable: false、userInvocable: false，source 是 dsh-csmm:off。
4. DSH 的模型技能目录和用户命令目录按 invocation 过滤，所以模型发现不了、也加载不了它。
5. 管理器列表会过滤影子，并合成一条 provider 为 dsh-csmm:policy 的“已停用”条目，方便再打开。

因此：

- 源文件保留，正文不删。
- 当前会话不重新注册，开关不会即时改变已经创建的 agent。
- 已经加载进对话的正文不会被撤回。
- 目录里本来就不存在这个技能时，不需要也不会注册影子。
- project / runtime / dsh-csmm 运行时技能不可停用：project 归 Git 管理且 rank 更高，插件运行时技能不是用户技能。
- 项目 .agents 源只读；项目 .dsh 下的 SKILL.md 可在受控条件下直接编辑（SHA 校验、旧字节备份、原子写），这是唯一允许改写真实技能源的路径。

### 3.5 界面入口

- 「配置集与生效」页：DSH 技能使用标准资源行和开关，切换当前作用域的 on/off；继承全局/恢复默认在详情中操作。停用行显示“已停用”，project/插件运行时行显示锁定说明。
- 「技能」页：中栏显示根优先级、策略来源和正文；项目 .dsh 源可编辑，项目 .agents 与全局/用户源只读，全局/用户技能可复制到工作区后再编辑。
- 配置集页的开关不是配置集成员勾选；DSH 技能始终不进入配置集白名单。

## 4. 对照表

| | 提示词段 | 插件自有技能 | DSH 注册表技能 |
|---|---|---|---|
| 来源 | 插件 sections/、DSH 宿主注册 | 插件 store | ctx.skills |
| 作用域覆盖 | 宿主注册按宿主管辖；自定义提示词跟随生效组 | 工作区同名覆盖全局 | 宿主层与 rank 裁决 |
| 配置集 | 段白名单 | 技能白名单 | 不参与 |
| 自身开关 | disabledPrompts（禁用优先） | enabled + 配置集勾选 | skillPolicy（on/off/inherit） |
| 继承 | activeGroup 缺键继承，空串阻断 | 工作区同名覆盖 | 工作区 > 全局 > 默认 on |
| 空配置集 | 段全过滤，工具全拒绝 | 不注册任何组内技能 | 不受影响 |
| 生效时间 | 下一轮装配 | 新 agent | 新 agent |
| 写入目标 | 插件 store / 宿主注册 | 插件 store | 插件 store（只写策略，不写源） |

## 5. 常见问题

**为什么关了技能，管理器里还能看到？**
管理器会合成“已停用”条目，目的是让你能重新打开；模型目录和用户命令目录里已经被影子过滤掉。

**为什么当前会话还能用？**
技能注册发生在创建 agent 时。开关只改 store，要等新会话/子代理重新创建 agent。

**为什么项目技能不能关？**
project 来源由 Git 管理，且宿主 rank 高于运行时影子；插件不能可靠地遮蔽它。只能改项目源文件，不能靠策略假装关掉。

**为什么工作区不能重新打开全局禁用的提示词段？**
disabledPrompts 是全局与工作区的并集，禁用优先；工作区只能追加禁用，不能撤销全局禁用。

**为什么空配置集会全禁？**
配置集是白名单；active 存在但名单为空表示“允许零个”，不是“不过滤”。只有完全没有生效配置集时才不过滤。

**为什么提示词开关不影响工具 schema？**
工具定义不属于 sections，走 tools.restrict 的独立白名单；提示词页的段开关只过滤提示词段。

**为什么 custom 技能可能关不掉？**
custom 只是来源标签；运行时影子能否压住它取决于宿主提供方的 rank。project 明确压不住，custom 需要看实际 provider。

## 6. 边界与未实现

- 当前实现只落了 skillPolicy 的 scope + cwd 覆盖；activation、trigger、hook 的覆盖尚未实现，不能按已有能力使用。
- 技能策略不承诺当前会话即时生效；DSH 注册表本身也按 agent 创建时装配。
- 本文描述的是插件行为；宿主对 invocation、rank 和技能目录的最终解释仍以 DSH 实现为准。

## 7. 代码位置

- src/shared/resolve.ts：winningLayer、visibleSkills、chainFor。
- src/shared/policy.ts：sectionAllowlist、toolAllowlist、isAllowed。
- src/shared/skillPolicy.ts：根优先级、可停用来源、resolveSkillPolicy。
- src/host/materialize.ts：registerAgentPrompts、registerAgentPromptFilter、registerAgentSkills、registerAgentTools、skillPolicyOff。
- src/host/service.ts：listDshSkills、getDshSkill、saveDshSkillSource、skill.policy 写入。
- src/UI/view/components/GroupEditor.tsx：配置集页 DSH 资源行与开关。
- src/UI/view/components/SkillPane.tsx：技能详情、策略操作与源编辑。
- README.md：存储布局、RPC、限制与测试命令。

---

文档状态：与当前实现同步。行为变更时同时更新本文、README 和 AGENTS 的相关说明。
