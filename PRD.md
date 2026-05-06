# ThunderClaw PRD

Thunderbird XPI 扩展，新增 "AI 视图" 标签页，由用户本地已登录的 Claude Code CLI 或 Codex CLI 驱动。

## 0. 平台与发布

- **目标 Thunderbird 版本**：128 ESR
- **支持平台**：Thunderbird 官方支持的全部平台（macOS / Windows / Linux）
- **实现语言**：TypeScript
- **UI 语言**：v1 仅 zh-CN

## 1. 三层 Agent 流水线

### 1.1 Roost（程序 A · 归集）

按联系人聚合数据，建立每个联系人的上下文：

- **输入**：本地已下载的邮件（含发件人、收件人、抄送）+ 日历事件
- **聚合单元**：联系人。一个联系人可能对应一个或多个邮箱地址
- **联系人识别**三层置信度：
  1. Thunderbird Personal Address Book 命中
  2. Collected Addresses Book 命中
  3. 裸地址：用最近一封邮件 `From` 头的 Display Name 兜底
- **不自动建联系人**。在 AI 卡片上提供 "另存为联系人" 的轻动作
- **多邮箱合并**只在用户在 contact card 显式挂多个 email 时才做，AI 不要猜
- **邮箱归一化**只做域名小写，本地部分不归一
- **多账户**：所有账户的邮件 + 日历汇入同一张联系人图，最终输出一份合并的结果

### 1.2 ContactPulse（Agent a · 逐人分析）

逐个遍历 Roost 输出的联系人，调用 LLM 分析：

- **输入**：该联系人的邮件正文 + 其他收件人 + 发件时间 + 相关日历事件
- **输出**：每个联系人 0 个或多个 "重要事项" 卡片
- **每张卡片包含**：
  - 标题、摘要
  - 优先级（高 / 中 / 低）
  - 截止时间（如有）
  - actionType：`reply` / `acknowledge` / `none`
  - **suggestedActions**：当 actionType=`reply` 时，2–4 个候选**自然语言动作**（不是完整回复正文），覆盖不同合理处理方向（确认 / 婉拒 / 反问 / 推迟 等）；其它情况为空数组
  - AI 判断依据（reason）
  - 关联的原邮件 ID 列表（点击可展开预览 / 跳到 TB 邮件视图）
- 没有重要事项的联系人：不出卡片
- **关键决策**：Pulse 阶段不预生成完整回复正文，避免给从不打开的卡片烧 token。完整正文由 Writer agent (§1.4) 在用户点动作时按需生成。

### 1.3 Briefing（Agent b · 全局汇总）

把所有联系人产出的重要事项再做一次 LLM 汇总：

- 合并相关事项、去重
- 全局排优先级
- 输出最终的 "今日简报"，是 AI 视图主屏显示的内容
- 卡片结构与 ContactPulse 一致

### 1.4 Writer（按需触发的回复生成 agent）

用户在简报卡上点了某个 suggestedAction 按钮 → 触发独立的 LLM 调用生成实际回复正文：

- **输入**：item 上下文（联系人 / 标题 / 关联邮件正文）+ 用户选中的 action label + 用户自我介绍
- **输出**：纯文本回复正文（无 Subject、无 markdown 围栏）
- 生成完成后内联展开在卡片底部，配三个按钮：**在撰写窗口打开** / **复制** / **重新生成**
- 用户切到下一张卡时生成态自动清空，不持久化

**为什么分两个 agent 而不是 Pulse 一次出完整回复**：
- 用户大部分卡只是 ack 一下，从不打开回复；Pulse 一次生成 N 张卡的完整正文是浪费
- 回复方向有多个（确认/婉拒/反问），按钮表达比单一文本表达更准
- 语气调整（正式/友好/简短）直接编进 action label，不用单独一套 tone preset 重生成

### 1.4 重要性判定 Rubric

ContactPulse 和 Briefing 推理时**不靠硬编码规则**，而是把一份用户专属的 Markdown 文件 `rubric.md` 作为 system prompt 的一部分。这份文件由 AI 持续维护，用户也可以手动编辑。

**文件位置**（跨平台，Native Host 决定）：
- macOS: `~/Library/Application Support/ThunderClaw/rubric.md`
- Linux: `~/.config/thunderclaw/rubric.md`
- Windows: `%APPDATA%\ThunderClaw\rubric.md`

**结构**（Markdown，章节固定）：
- 用户画像（来自自我介绍 + 历史邮件分析）
- 高 / 中 / 低 / 过滤 四级规则，每条带理由 + 例子
- 联系人画像（重点联系人 + 静音名单）
- 学到的模式

**生命周期**：

1. **初始化**：onboarding 完成 + 首次 Roost 完成后，调一次 LLM 生成初版 rubric（输入：自我介绍 + 邮件 corpus 的统计画像 + 约 50 封代表性样本）
2. **使用**：每次 Pulse / Briefing 推理时，rubric 全文塞 system prompt
3. **更新**：用户的所有处置动作（"我已知晓" / "不重要" / "在撰写窗口打开" / 手动改优先级）追加写入 `feedback.log`（JSONL）。累积 ≥ 10 条事件 **或** 距上次编辑 ≥ 24h（任一）触发 Rubric Editor agent 把 log 编入 rubric

**保护机制**：
- 大小硬上限 4KB / 200 行；超出时 Editor 被要求合并/精简学到的模式章节
- 每次 AI 写入前 `cp rubric.md rubric.md.bak`
- 手动编辑保护：记录 mtime；下次写入前如发现用户改过，**用用户版本作为新 baseline**，AI 永不覆盖用户改动
- 文件损坏/不存在时用 `.bak` 兜底；都没有则用一套硬编码 default rubric 临时回退，下一轮 Editor 重建

**用户可见性**：
- 状态栏短提示 "Rubric 已更新到 v8"
- AI 视图右上角角标 "学到 N 条新模式"，点击查看 diff
- 设置面板提供 "打开 rubric.md / 还原默认 / 清空学习记录" 三个按钮

## 2. 数据源

### 2.1 邮件

- 仅使用本地已下载内容（MailExtension API 限制）
- 范围：最近 30 天 或 每文件夹最近 300 封（取并集后去重）
- **扫描的文件夹**：默认包含所有文件夹，但**排除** Junk / Trash / Drafts
- **Sent 文件夹必须包含**——AI 推荐回复的语气样本来源
- 首次安装引导用户给 INBOX / Sent / 重要文件夹勾选 "Make messages available offline"
- 运行时 Pulse 阶段才用 `messages.getFull()` 拉 body，单封 5 秒超时——避免 IMAP 同步整个文件夹拖死流水线
- **正文不做清洗**，原样送 LLM（v1 不折腾 HTML→text、引用裁剪、签名识别等）
- **附件 v1 完全忽略**（不读元数据也不解析内容）

### 2.2 日历

- 通过 `messenger.calendar.*` 读取
- 用途：(a) 推荐回复时知道用户空闲 / 冲突；(b) 会议邀请类邮件可建议建日历事件；(c) 时间相关事项关联到日历
- v1 **不**包含 Tasks

## 3. 触发与缓存

- **新邮件到达** → 标记该联系人 dirty → 立即跑 ContactPulse 的单人分析
- **Briefing（Agent b）** 走 debounce，三个条件任一即触发：
  - 最后一封新邮件之后静默 30 秒
  - 用户切到 AI 视图
  - 每 5 分钟到点
- 联系人分析结果按 contact 缓存，只在该 contact 有新邮件时重跑
- **执行模型**：v1 全程**串行**调用 CLI（不假设支持并发）。首次扫描可能较慢，可接受
- 首次运行预期：仅活跃联系人 5–10 分钟（取决于 CLI 响应速度，串行下可能更长）；之后只增量

### 3.1 暂停 / 后台运行

Mockup ③ 提供两个按钮：
- **暂停**：当前联系人分析跑完后停下，不继续下一个；状态栏可见，用户点 "继续" 恢复
- **后台运行**：用户可以离开 AI 视图标签，Native Host 继续在后台跑；完成后系统通知

## 4. UI

以 `Mockup.html` 为视觉与交互规范。包含 5 个屏幕：

1. **CLI 未登录引导**：检测到本地 Claude Code / Codex CLI 未登录时显示，给出登录命令
2. **自我介绍（选填）**：CLI 登录完成后插入的一步，引导用户写一段自我介绍。设计风格与屏幕 ① 一致
3. **Agent 流式日志**：分析过程中显示三层流水线进度（Roost / ContactPulse / Briefing）+ 实时日志
4. **今日简报（双栏）**：左侧事项列表，右侧选中事项的详情 + 建议回复 + AI 判断依据 + 行动按钮
5. **空态（今日无重要事项）**：列出最近几条低优先级摘要供参考

### 4.1 关键 UI 元素

- 优先级 pill：高 / 中 / 低
- **"发生了什么" 区域**可点击展开：内联展示最近一封原邮件的 subject / from / date / body 预览（HTML 已脱皮成纯文本）+ "在 Thunderbird 中打开"按钮
- **建议回应方式**（actionType=reply 时）：一排短按钮，每个按钮是一个**自然语言动作**（如"回复确认本周内提交"、"回复请求延期"、"回复反问具体格式"）。首选高亮蓝，其它白底
  - 点击按钮 → 内联展开 Writer agent 生成的回复正文 + 三个按钮：**在撰写窗口打开** / **复制** / **重新生成**
  - 切到下一张卡时生成态自动清空
  - **不再有 "正式 / 友好 / 简短" 语气切换**——语气直接嵌入 action label，按需再加一个动作即可
- 主行动按钮（卡片底部）：
  - 通知类事项 (actionType=acknowledge / none)："我已知晓"（主）
  - 需回复事项无 "我已知晓"（已经有上面的回复动作）
- 副按钮："不重要 · 不再提示"
- "AI 的判断依据" 始终展示，解释为什么这样推荐

### 4.2 操作语义 + 反馈

每个动作完成后，右下角弹一个 toast，3.5 秒自动消失，告知后台具体做了什么。

- **"我已知晓"**：该 item 立刻消失，**同时把所有关联邮件 `messages.update({read:true})` + `messages.archive(...)`**（按 TB 归档策略，通常归到 Archives/年份）
  - Toast：`✓ 已标为已读 · 归档 N 封` / 出错时 `⚠ 已标读 N 封，但归档失败：<原因>`
  - 该联系人后续再来新邮件触发新分析时，已 ack 的 thread 不再产出 item，但全新事项仍会出
- **"不重要 · 不再提示"**：对该联系人的该 thread **永久压制**（不是对整个联系人）
  - Toast：`✓ 已压制此 thread · 不会再提示`
- **"在 Thunderbird 中打开"**（在原邮件预览里）：调 `messageDisplay.open(messageId)`，跳到 TB 标准邮件视图
- **"复制"**（生成的回复）：写入剪贴板。Toast：`✓ 已复制到剪贴板`

### 4.3 撰写窗口预填默认行为

点击某个 suggestedAction → Writer 生成回复 → 用户检查 → 点击 **"在撰写窗口打开"** 时调 `messenger.compose.beginReply()`：

- 默认 **reply**（非 reply-all）
- Writer 生成的正文放在**引用原文之前**
- **保留用户签名**（顺序：AI 正文 → 用户签名 → 引用原文）
- **HTML / 纯文本跟随原邮件格式**（同时传 `body` HTML + `plainTextBody` 兼容）
- beginReply 失败时兜底用 `compose.beginNew({to, subject, body})` 开新邮件
- 永不自动发送，用户必须手动点撰写窗口里的发送

## 5. AI 后端

- **不接云 API、不收 API key**，复用用户本地已登录的 CLI
- 支持 Claude Code CLI 和 Codex CLI 两种后端，运行时探测可用性
- **同时检测到两个 CLI 时**：用户在设置里可选，**默认 Claude Code**
- **登录态探测**：检查 `~/.claude/` 存在 + 跑 `claude config get` 看退出码，两条都过才算登录；Codex 同理
- **调用方式**：通过 Native Messaging Host

### 5.1 Native Messaging Host

- 因为 XPI 沙箱无 `child_process`，单独写一个 Node helper 程序
- 扩展通过 stdin/stdout 与 helper 通信
- helper 负责 spawn `claude -p` / `codex exec`
- 不走 fork Thunderbird、不走 Experiment API（前者维护代价高，后者失签名）

### 5.2 Native Host 安装方式

- 提供**一键安装器**：macOS `.pkg` / Windows `.msi` / Linux `.deb`
- 安装器负责把 helper 二进制和 NativeMessagingHosts manifest 文件放到对应 OS 的标准位置
- 扩展启动时检测 helper 可用性，未检测到则在 UI 引导用户下载安装

**Linux .deb（已实现 v0.1.6）**：

```
/usr/lib/thunderclaw/                       native host runtime + wrapper
/usr/lib/mozilla/native-messaging-hosts/    NMH manifest (system-wide, 所有 TB 都读)
/opt/thunderclaw/thunderclaw.xpi            extension XPI
/etc/thunderbird/policies.json              Mozilla Enterprise Policy 自动装 XPI
```

**关键技巧**：用 `policies.json` 的 `ExtensionSettings` + `installation_mode: normal_installed` 让 TB 自动把 XPI 装进所有 profile，**绕过未签名扩展的安装限制**。postinst 用 Python 做 JSON merge，不会覆盖用户已有的其它 policies。postrm 反向 prune。

**macOS / Windows**：尚未实现（v0.2 计划），暂时仍走 `node scripts/install-native-host.mjs` + 手动拖 XPI 进 Add-ons 的两步法。

### 5.3 用户自我介绍

- 在 onboarding 流程里（CLI 登录之后）插入一步，让用户写一段自我介绍。**选填**，可跳过
- 跳过的情况下，AI 从用户的历史 Sent 邮件里自己摸索身份/语气
- 后续可在 设置 → AI 助手 里随时修改
- 内容仅本地保存（参见第 6 节）
- 用途：作为 ContactPulse 和 Briefing 的 system prompt 上下文，让推荐回复更贴近用户的真实身份和语气

## 6. 状态持久化

两路存储：

**A. `browser.storage.local`（IndexedDB）** — 用于扩展运行时状态
  - 每个联系人的最近一次 Pulse 分析结果（缓存）
  - 用户处置记录："我已知晓" / "不重要 · 不再提示"
  - 最近一次 Briefing 输出
  - 用户自我介绍文本
  - 设置：选用的 CLI、扫描文件夹、时间窗口

**B. 文件系统（由 Native Host 读写）** — 用户能直接看到的产物
  - `rubric.md`（重要性判定标准，AI 维护，用户可改）
  - `rubric.md.bak`（最近一次备份）
  - `feedback.log`（JSONL，append-only，编入 rubric 后清空）

设置面板提供：
- "清除 AI 数据" 按钮（清空 IndexedDB）
- "打开 rubric.md" / "还原默认 rubric" / "清空学习记录" 三个按钮（操作文件）

v1 **不**做跨设备同步、不做手动备份/导出。

## 7. 安全 & 容错

### 7.1 安全
- **不自动发送邮件**。所有 AI 推荐回复的执行路径都是 "在撰写窗口打开 + 预填草稿"，让用户最后过一眼
- **Prompt injection 防御**：邮件正文喂给 LLM 之前包成 `<email>...</email>`，system prompt 明确声明邮件内容是数据不是指令

### 7.2 失败处理
原则：**部分结果 > 全无**，单点失败不阻塞整批。

- **CLI token 过期 / 未登录**：暂停整批 → 弹回 ① CLI 引导屏
- **LLM 返回无法 parse 的 JSON**：retry 1 次；仍失败则跳过该联系人，错误进 log
- **Native Host 崩溃**：扩展自动重启 + UI 提示
- **IMAP 临时断网**：用上一次 briefing 继续展示，状态栏标 "数据可能过期"
- **单联系人邮件量过大（>200）**：截到最近 30 封；较早的只发 metadata（subject + date）

## 8. 实施进度

- [x] `manifest.json` + 最小 MailExtension（v0.1.0）
- [x] Native Messaging Host：独立 Node 程序，stdio 协议（v0.1.2）
- [x] Roost 阶段：枚举邮件 + 联系人聚合（v0.1.2）
- [x] ContactPulse + Briefing LLM 调用 + 流式输出（v0.1.2）
- [x] UI 落地（CLI Picker / Intro / Loading / Briefing 双栏 / 空态）（v0.1.2）
- [x] 撰写窗口预填（v0.1.2）
- [x] 30 天扫描窗口 + body fetch 5s 超时（v0.1.3）
- [x] "发生了什么" 可展开看原邮件 + 跳 TB 邮件视图（v0.1.4）
- [x] "我已知晓" 自动标已读 + 归档（v0.1.4）
- [x] Linux `.deb` 一键安装（v0.1.6）
- [x] **Pulse 改输出 suggestedActions，新增 Writer agent 按需生成回复**（v0.1.7）
- [x] 动作 toast 反馈（v0.1.8）
- [ ] macOS `.pkg` / Windows `.msi` 安装器
- [ ] 日历集成（API 在 TB 140 部分实验性）
- [ ] Rubric 文件（AI 自维护的判定标准）
- [ ] 设置面板（CLI 切换、清除数据、编辑自我介绍）
- [ ] 新邮件触发增量分析

## 9. v1 明确不做

- Tasks 集成
- 跨设备同步 / 手动备份导出
- 接受用户填 API key 直连 Anthropic API
- 自动建联系人、自动合并不同邮箱
- 自动发送邮件
- Fork Thunderbird
- CLI 并发调用（先假设串行）
- 邮件正文清洗（HTML→text、引用裁剪、签名识别）
- 附件处理（不读元数据也不解析）
