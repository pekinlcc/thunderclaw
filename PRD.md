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
  - **suggestedActions**：一组**用户视角的决定**（如"我要参加" / "我不参加" / "咨询会议形式" / "我已知晓"）。每个决定打包成 1-N 个原子操作步骤（见 §1.5）
  - AI 判断依据（reason）
  - 关联的原邮件 ID 列表（点击可展开预览 / 跳到 TB 邮件视图）
- 没有重要事项的联系人：不出卡片

**关键设计原则**：Pulse **不再列原子操作**（如"加日历"、"回复确认"），而是站在用户视角想"面对这件事，我可能想做的几种决定"，每个决定打包多个步骤一键执行。Pulse 也不预生成回复正文——回复正文由 Writer agent (§1.4) 在用户点动作时按需生成。

### 1.3 Briefing（Agent b · 全局汇总）

把所有联系人产出的重要事项再做一次 LLM 汇总：

- 合并相关事项、去重
- 全局排优先级
- 输出最终的 "今日简报"，是 AI 视图主屏显示的内容
- 卡片结构与 ContactPulse 一致

### 1.4 Writer / Event Extractor / Task Extractor（按需触发的执行 agent）

用户点某个 suggestedAction 按钮 → 系统按 `steps` 顺序执行原子操作。每种 step kind 对应一个 agent / API：

| kind | 处理 | Agent / API |
|---|---|---|
| `reply` | 生成回复正文 | Writer agent → claude --print |
| `calendar` | 解析日期/地点 + 创建事件 | Event Extractor agent → `messenger.calendar.items.create()` 或 .ics 兜底 |
| `task` | 解析待办 + 创建任务 | Task Extractor agent → `messenger.calendar.items.create({type:'task'})` 或 VTODO .ics 兜底 |
| `acknowledge` | 标已读 + 归档 + 从简报移除 | `messages.update({read:true})` + `messages.archive()` |

**Reply step 永远最后跑**：calendar / task / acknowledge 是后台操作 + toast 反馈；reply 生成完正文后内联展开等用户审稿，配三按钮 **在撰写窗口打开** / **复制** / **重新生成**。永不自动发送。

**为什么不让 Pulse 一次生成所有内容**：
- 用户大多数卡只点 acknowledge，从不打开回复；Pulse 一次生成 N 张卡的完整正文是浪费
- 同一邮件多个决定（参加/不参加/咨询）共享 thread context，但需要不同方向的回复——按需生成更精准
- 语气调整直接编进 action label，不再有独立的 tone preset

### 1.5 SuggestedAction 数据结构

```ts
SuggestedAction = {
  label: string;       // 用户视角的决定，如 "我要参加" / "我不参加" / "咨询会议形式" / "我已知晓"
  steps: ActionStep[]; // 该决定要顺序执行的原子操作
};
ActionStep = {
  kind: 'reply' | 'calendar' | 'task' | 'acknowledge';
  detail: string;      // 喂给对应 agent 的 prompt 输入
};
```

**举例**：邮件是"K 年级说明会 5/12 17:40 校礼堂"

```js
[
  { label: "我要参加",
    steps: [
      { kind: "calendar", detail: "加日历: K 年级说明会, 5/12 17:40, 校礼堂" },
      { kind: "task",     detail: "加任务: 5/11 前提交在线报名表" },
      { kind: "reply",    detail: "回复学校：确认参加 5/12 K 年级说明会" }
    ]
  },
  { label: "我不参加",
    steps: [
      { kind: "reply",       detail: "回复学校：抱歉无法参加，能否提供录像" },
      { kind: "acknowledge", detail: "" }
    ]
  },
  { label: "咨询会议形式",
    steps: [{ kind: "reply", detail: "回复反问：是线上还是线下，是否会有录像" }]
  },
  { label: "我已知晓",
    steps: [{ kind: "acknowledge", detail: "" }]
  }
]
```

**硬规则**：
- 每张卡 2-4 个 SuggestedAction
- **总有一个兜底"我已知晓"决定**（单步 acknowledge）让用户能直接 dismiss
- 邮件**含具体日期+时间** → "参加"类决定里**必须**有 calendar step
- steps 数组可以只有 1 个元素（如纯通知类邮件就只一个 acknowledge step）
- 多步决定（≥2 step）UI 上会有 ⚙ 角标，点开展开 checkbox 让用户取消勾选某些步骤再执行

### 1.6 状态持久化的 schema 版本

`AppState` 含 `schemaVersion: number`。bump 这个数字（在 `src/background/store.ts` 里）会让所有用户在升级后**第一次 getState 时自动清掉 briefing / acknowledged / muted 等运行时缓存**（保留 intro / selectedCli 等用户配置）。任何改 BriefingItem / SuggestedAction 形状的版本都要 bump。这避免新代码读到老 schema 数据时 UI 渲染崩溃。

### 1.7 重要性判定 Rubric

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
- **引擎选择**：onboarding 第一步让用户在两个已登录的 CLI 里选一个，存进 `state.selectedCli`。所有 LLM 调用（Pulse / Briefing / Writer / Event+Task Extractor）都根据这个选项分发；不存在"默认引擎"——没选完 intro 就不会跑流水线
- **登录态探测**：检查 `~/.claude/.credentials.json` 里有 `accessToken` 才算 Claude 已登录；Codex 看 `~/.codex/auth.json` 或 `~/.config/codex/auth.json` 存在
- **调用方式**：通过 Native Messaging Host，统一走 `llm-call` RPC，把 `engine: 'claude' | 'codex'` 作为参数透传

### 5.1 Native Messaging Host

- 因为 XPI 沙箱无 `child_process`，单独写一个 Node helper 程序
- 扩展通过 stdin/stdout 与 helper 通信（4-byte length-prefix JSON）
- **版本握手**：扩展启动时调 `host-info` 拿 `{version, protocolVersion}`。`PROTOCOL_VERSION` 仅在 helper 支持的方法集发生变化时 bump（当前 = 3）。host 不认 `host-info`（pre-v0.1.18）或 `protocolVersion` 低于 `EXPECTED_PROTOCOL_VERSION` → UI 顶端红条提示重装；版本号不一致但 protocol 够 → 黄条提示同步更新。`native-host/version.mjs` 在每次 build 时由 `scripts/build.mjs` 从 `src/manifest.json` + `src/shared/protocol.ts` 自动生成。
- helper 收到 `llm-call` 后按 `engine` 字段路由：
  - **claude**：spawn `claude --print --max-turns 1 --output-format text`，prompt 走 stdin，`--append-system-prompt` 注入 system prompt，`--disallowedTools` 关掉所有工具只取文本
  - **codex**：spawn `codex exec --skip-git-repo-check --color never -o <tmpfile>`，cwd 设到独立 tmpdir（避开 git 仓库检测），prompt 走 stdin（system prompt 拼前面），最后从 `tmpfile` 读"最后一条 agent message"——这样规避 codex stdout 含 banner/推理/turn marker 的噪音
- 严格分发：未知 engine 在 helper 端直接抛错，不静默回退到任一 CLI
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
- **LLM 返回无法 parse 的 JSON**：跳过该联系人；console 打出原始输出的头尾各 400 字符 + 总长度，便于诊断（v0.1.16）
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
- [x] **日历集成 + 任务集成**（v0.1.9 / 含 Event Extractor、Task Extractor agent + .ics 兜底）
- [x] **复合用户决定按钮**（v0.1.10 / SuggestedAction.steps 嵌套结构 + ⚙ 调整面板 + 一键 fire 全套）
- [x] **Schema 版本化 + 自动迁移**（v0.1.11 / 升级时自动清掉旧 schema 缓存，避免 UI 渲染崩溃）
- [x] **静默 .ics 兜底 + 自动用 Thunderbird 打开**（v0.1.12 / 不再弹保存对话框）
- [x] **.ics 兜底文件落到 Downloads/ThunderClaw/ + 10s 后自动清理**（v0.1.13）
- [x] **修复"执行中..."按钮卡死 + Extract agent 超时收紧到 60s**（v0.1.14）
- [x] **CLI 引擎分发按用户在 intro 里的选择路由**（v0.1.15 / 加 `llm-call` RPC + Codex 通过 `-o tmpfile` 拿干净输出 + 严格分发不静默回退）
- [x] **诊断日志加厚**（v0.1.16 / Pulse 解析失败贴出原始输出头尾、Codex 失败带上 stderr+stdout、callLLM 入口打 engine 名）
- [x] **修四个真 bug**（v0.1.17）：
  - 加 `downloads.open` 权限——之前缺权限导致 .ics fallback 静默失败但 UI 谎称"已弹导入提示"
  - BriefingItem 加 `replyToMessageId` / `replyTargetIsUserSent` / `incomingEmailIds`——避免 follow-up 场景下 `replyToSender` 把信发给用户自己，归档也只动收到的那部分不动 Sent
  - 复合 intent 含 reply+ack 时把 ack 推迟到用户开撰写窗口后再跑，否则卡片会在用户看到回复正文之前就被 acknowledged 过滤掉
  - LLM 输出 `priority` 不在白名单时归到 'medium'（防 UI 渲染崩）；`items` 不是数组时跳过该联系人
- [x] **Native host 版本握手 + tarball 释出**（v0.1.18）：
  - 加 `host-info` RPC + `PROTOCOL_VERSION` 元数据，扩展启动时握手，host 过旧 / 不一致就在 UI 顶端弹红/黄条 + 一键复制重装命令
  - 释出 `thunderclaw-native-host-v<v>.tar.gz` / `.zip`，Mac/Win 用户不用 git clone 整个仓库；Linux 仍优先 `.deb`
  - 堵掉"XPI 升了 host 没升 → 全部 `unknown method: llm-call` → 用户看到'今日无重要事项'但毫无提示"那个隐蔽坑
- [x] **邮件预览 fallback 顺序修复**（v0.4.1）：事项关联多封邮件时，"发生了什么"优先尝试最近收到邮件，其次 reply target，再兜底全部 emailIds；某一封不可读不会让整个预览失败，"在 Thunderbird 中打开"也打开实际预览成功的那封。
- [x] **日历直写 Thunderbird 本地日历 SQLite，零对话框**（v0.4.0）：
  - AMO unlisted 签名禁用 `experiment_apis`，所以不能从扩展进程内调 `cal.manager.adoptItem`。改让 native host 直接 INSERT 到 `<profile>/calendar-data/local.sqlite`：解析 prefs.js 找 `type="storage"` 的本地日历 UUID，往 `cal_events` / `cal_todos` + `cal_properties` 写行；WAL 模式 + busy_timeout=5s，能跟运行中的 TB 并发写
  - PROTOCOL_VERSION 5 = 加 `direct-calendar-create` RPC；calendar.ts 把这个放第一层，老 host / 没本地日历时回退到 v0.1.20 的 NMH 导入对话框路径
  - host binary 体积涨到 ~6.7MB（带 modernc.org/sqlite，纯 Go 无 CGO，方便跨平台 build）
  - 已知限制：TB 内存里 calendar manager 不会立刻 reload，用户切到日历 tab 或重启才看见新事件——签名 + experiment_apis 才能拿到 in-process refresh，那条路 Mozilla 给的 unlisted 签名不允许
- [x] **Native host 重写为 Go 单二进制 + 全平台一键安装器**（v0.3.0）：
  - native-host/*.mjs（Node）→ host/*.go（Go），交叉编译 5 个 target（linux/darwin × amd64/arm64 + windows-amd64），每个 ~2MB 静态二进制。**用户机器不再需要 Node.js**。
  - 版本号通过 `-ldflags "-X main.Version=…"` 在 build 时烧进 binary，host-info RPC 返回的版本永远跟扩展端 manifest 对齐
  - `.deb` 改成 amd64-specific（之前是 arch=all），`Depends: nodejs` 删掉，体积从 220KB 涨到 1MB（带 Go binary）
  - 全平台一键 installer：
    - Linux: `scripts/install-linux.sh`（apt 系优先 .deb，arm64 / 其它发行版退到 tarball；自动检测 snap thunderbird 弹警告）
    - Mac: `scripts/install-mac.sh`（已有，去掉 Node 依赖）
    - Win: `scripts/install-windows.ps1`（PowerShell，下 zip → 装 binary → 写注册表 NMH manifest → user.js 自动启用 → 启动 TB）
  - `.deb` postinst 检测 snap thunderbird → 弹横条警告 + 指向 `migrate-snap-tb.sh` 一键迁移脚本
  - `npm run sign` 命令（`scripts/sign.mjs`）—— Mozilla AMO 自分发签名脚手架，等用户提供 `AMO_JWT_ISSUER` + `AMO_JWT_SECRET` 就能跑。签名后的 XPI 解锁 `experiment_apis`，日历直写无对话框
- [x] **解掉 v0.2.0 的 mozillaAddons 坑**（v0.2.1，紧急 hotfix）：v0.1.23 在 manifest 里加的 `experiment_apis` + `mozillaAddons` 权限要求 XPI 已签名，未签名 XPI 在 TB ESR/release 上**整个加载不上**——v0.2.0 装上去用户连扩展图标都看不到。v0.2.1 把这两块从 manifest.json 拿掉，build 时跳过 `experiments/` 目录的打包（代码留着，等 AMO 签名后再开）；`packaging/deb/control.template` 的 `Recommends: thunderbird` 改 `Suggests`，避免 .deb 安装时 apt 自动把 snap thunderbird 拽回来。
- [x] **新邮件触发增量重算 + 简报顶端总览条**（v0.2.0）：
  - 新邮件到达 → background 监听 `messages.onNewMailReceived` → 把发件人塞 debounce 队列（30 秒）→ 到期后只对受影响联系人重 Pulse + 全量重 Briefing（产出新顺序 + 新 overview）
  - 用户在简报顶端 toggle 一键关掉自动重算（默认开）
  - Briefing agent prompt 加了 `overview` 字段：1-2 句中文整体概览，"指明谁/什么事/为什么紧"，避免空话
  - UI 顶端新增 `OverviewBar`：总数 + 高/中/低 priority pill 计数 + 折叠展开的 1-2 句概览 + auto-recompute 开关
- [x] **日历/待办直接写入 Thunderbird，不再进入导入向导**（v0.1.23）：普通 MailExtension 没有官方 calendar create API，新增 `thunderclawCalendar` Experiment API，把 VEVENT/VTODO 直接解析成 `CalEvent` / `CalTodo` 并 `adoptItem` 到第一个可写且支持对应类型的日历；失败时才回落到 v0.1.20 的 NMH `.ics` 导入路径。
- [x] **install-mac.sh 不再走 GitHub API**（v0.1.22）：之前用 `api.github.com` 解版本号，未认证 60 次/小时，重跑两三次就 403。改用 `/releases/latest` 的 302 重定向 location（不限流）；resolve 失败硬退出 + 提示用户传具体版本号。
- [x] **install-mac.sh 兼容 bash 3.2**（v0.1.21）：macOS 自带 bash 3.2.57，`set -u` + `local var="value"` 在 piped-bash 上下文里偶发不绑定，会让 user.js 那一步前死掉，导致 sideloaded XPI 没启用。改用两行 `local var; var=...` 形式 + 去掉 `-u`。
- [x] **NMH 路径直接让 TB 弹原生导入对话框**（v0.1.20 / PROTOCOL_VERSION=4）：
  - 加 `open-calendar-ics` RPC：native host 写 tmp.ics + spawn `open -a Thunderbird` (Mac) / `thunderbird file.ics` (Linux/Win)，TB 自己弹原生"导入事件"对话框，用户点一下"导入"就完事
  - 之前的"已保存到 Downloads/...，请双击打开导入"链路彻底退到只在 NMH 失败时兜底
  - 解决根因：TB 128 标准 WebExtension 表面其实不暴露 `messenger.calendar` namespace，永远走 fallback；又 Mac 上系统默认 .ics handler 是 Apple Calendar 不是 TB，`downloads.open` 即便能成也跑错 app
- [x] **Mac 一键脚本 install-mac.sh**（v0.1.19）：
  - 一行命令：`curl -fsSL .../install-mac.sh | bash` —— 自动装 native host + 把 XPI 落进默认 profile 的 `extensions/` + 写 user.js（autoDisableScopes=0、xpinstall.signatures.required=false）+ 重启 TB
  - 用 sideload 路径而不是 `.pkg`：不需要 Apple Developer ID 签名，无 Gatekeeper "无法验证开发者"弹窗
  - 卸载：同一脚本带 `uninstall` 参数
- [ ] macOS `.pkg` / Windows `.msi` 安装器（如真要 GUI 双击体验再做；当前一键脚本已覆盖大多数场景）
- [x] **新邮件触发增量分析**（v0.2.0，对应原"新邮件触发增量分析"项）
- [ ] Rubric 文件（AI 自维护的判定标准）
- [ ] 设置面板（CLI 切换、清除数据、编辑自我介绍）
<!-- moved up to v0.2.0 完成项 -->

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
