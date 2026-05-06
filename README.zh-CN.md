# ThunderClaw

> AI 邮件助手 · Thunderbird 扩展 · 后端复用本地 Claude Code CLI / Codex CLI
>
> [English](./README.md) · 中文（当前）

把你 Thunderbird 里散落几千封邮件，按联系人聚合，用本地已登录的 AI 命令行工具逐个分析，输出一份"今日真正需要回应的事项"简报。
**不需要 API key，不发邮件到云端**——所有 LLM 调用都通过你机器上已经登录的 `claude` 或 `codex` 进行。

![ThunderClaw AI 视图](Mockup.html "用浏览器打开 Mockup.html 看完整 UI 规范")

## 它做什么

三层 Agent 流水线：

1. **Roost** —— 扫本地 Thunderbird 的邮件 + 通讯录 + 日历，按联系人聚合（个人通讯录 / 已收集 / 裸地址 三层置信度）
2. **ContactPulse** —— 逐个联系人喂给 LLM，识别"用户当前最需要回应的事项"，给出优先级、建议回复、AI 判断依据
3. **Briefing** —— 全局合并、去重、排序，作为 AI 视图主屏内容

详细产品需求看 [`PRD.md`](./PRD.md)，UI 规范看 [`Mockup.html`](./Mockup.html)。

## 关键特性

- **完全本地**：邮件正文不上云，只跟你已登录的 CLI 进程对话
- **流式 UI**：每分析完一个联系人立刻把卡片冒出来，不用等全部跑完
- **优先级排队**：按 (未读 × 最近活跃 × 互发量) 评分，高分先分析
- **首次扫 Top 50**：不一上来就把几百个联系人全跑掉，长尾按需 "扫描更多"
- **撰写窗口预填**：建议回复点击后打开 Thunderbird 标准撰写窗口，**不自动发送**
- **持续学习（计划中）**：rubric.md 文件由 AI 维护并随用户操作演进，作为下次推理的 prompt 输入

## 系统要求

- Thunderbird **128 ESR 或更新**（推荐 140 ESR）
- Node.js **18+**（Native Messaging Host 用）
- 已登录的 [Claude Code CLI](https://docs.anthropic.com/claude/docs/claude-code) 或 [Codex CLI](https://github.com/openai/codex)

> ⚠️ **Ubuntu 24.04 用户**：snap 版 Thunderbird 因 portal 限制无法做 native messaging。请用 Mozilla 官方 tarball 或 Flatpak 版。详见下文 Linux 段落。

---

## 安装

ThunderClaw 由两部分组成：(1) 一个 Thunderbird 扩展（XPI）；(2) 一个 Native Messaging Host（Node 程序）负责 spawn CLI 进程。两者都需要安装。

### 通用步骤

1. **下载 XPI** —— 从 [Releases](https://github.com/pekinlcc/thunderclaw/releases) 拿最新的 `thunderclaw-x.y.z.xpi`
2. **下载或克隆源码** —— 因为 native host 需要在你机器上跑：
   ```bash
   git clone https://github.com/pekinlcc/thunderclaw
   cd thunderclaw
   ```

### Linux

```bash
# 1. 安装 Native Messaging Host
node scripts/install-native-host.mjs

# 2. 在 Thunderbird 里装扩展
#    菜单 → 附加组件和主题 → 齿轮 → 从文件安装附加组件 → 选 thunderclaw-x.y.z.xpi
#
#    若 TB 拒绝（要求签名），先在 about:config 里设置：
#      xpinstall.signatures.required = false
#    （ESR 版本支持这个开关）
```

**Ubuntu 24.04 特别说明**：snap 版 Thunderbird 上 native messaging **走不通**（portal WebExtensions backend 在 portal-gnome 47+ 才支持，24.04 ships 46）。两条路：

- **方案 A：用 Mozilla 官方 tarball**（推荐）：
  ```bash
  mkdir -p ~/opt && cd ~/opt
  wget -O tb.tar.xz "https://download.mozilla.org/?product=thunderbird-esr-latest-ssl&os=linux64&lang=zh-CN"
  tar xJf tb.tar.xz
  # 启动用 ~/opt/thunderbird/thunderbird，可写 ~/.local/share/applications/thunderbird-tc.desktop 加菜单入口
  ```
  你 snap 版的 profile 在 `~/snap/thunderbird/common/.thunderbird/`，tarball 版的 profile 在 `~/.thunderbird/`。要保留邮件数据先 `rsync -a` 拷过去。

- **方案 B：Flatpak**：`flatpak install flathub org.mozilla.Thunderbird`（portal 接入更稳）

### macOS

```bash
# 1. 安装 Native Messaging Host
node scripts/install-native-host.mjs

# 它会写到：
#   ~/Library/Application Support/ThunderClaw/      （host 库 + wrapper）
#   ~/.local/bin/thunderclaw-host                    （wrapper 软链）
#   ~/Library/Application Support/Thunderbird/NativeMessagingHosts/thunderclaw.json
#   ~/Library/Mozilla/NativeMessagingHosts/thunderclaw.json

# 2. 安装扩展
#    Thunderbird 菜单 → 附加组件和主题 → 齿轮 → Install Add-on From File
#    选 thunderclaw-x.y.z.xpi
```

如果 Thunderbird 拒绝未签名扩展，在 `about:config` 里把 `xpinstall.signatures.required` 改 `false`（ESR 支持）。

> macOS 端没有亲手测过，理论上能跑。问题反馈到 [Issues](https://github.com/pekinlcc/thunderclaw/issues)。

### Windows

```powershell
# PowerShell 或 CMD（管理员权限不需要，写的是 HKCU 不是 HKLM）
node scripts\install-native-host.mjs

# 它会：
#   - 写 host 库到 %LOCALAPPDATA%\ThunderClaw\
#   - 写 wrapper bat 到 %LOCALAPPDATA%\ThunderClaw\thunderclaw-host.bat
#   - 写注册表 HKCU\Software\Mozilla\NativeMessagingHosts\thunderclaw 指向 manifest

# 然后在 Thunderbird 里：
#   菜单 → 附加组件和主题 → 齿轮 → Install Add-on From File
#   选 thunderclaw-x.y.z.xpi
```

如果 Thunderbird 拒绝未签名扩展，在 `about:config` 里改 `xpinstall.signatures.required = false`（ESR 支持）。

> Windows 端也没有亲手测过。

---

## 使用

1. 打开 Thunderbird，左侧空间栏会多一个 **AI 助手** 蓝紫渐变图标（带蓝色 "AI" 角标）
2. 首次进入：
   - **CLI Picker**：选 Claude Code 或 Codex（默认 Claude）
   - **自我介绍**：选填，写一段你自己的身份/沟通偏好，AI 推荐回复时会参考
   - 然后自动开始 Roost → Pulse → Briefing
3. **Briefing 屏**：左边事项列表（按优先级排），右边详情 + 建议回复 + AI 判断依据
4. 行动按钮：
   - 需回复 → "在撰写窗口打开"（预填收件人/主题/正文，**你自己点发送**）+ "复制到剪贴板"
   - 通知类 → "我已知晓"
   - 不重要 → "不重要 · 不再提示"（按 thread 永久压制）
5. 首次只扫 top 50 联系人，扫完会出现 **"扫描更多"** 按钮按需续扫

---

## 开发

```bash
git clone https://github.com/pekinlcc/thunderclaw
cd thunderclaw
npm install
npm run build         # 输出 dist/thunderclaw.xpi
npm run watch         # 监听 src/ 自动重建
npm run typecheck     # tsc --noEmit
```

仓库布局：

```
thunderclaw/
├── src/
│   ├── manifest.json            # MailExtension manifest (MV2)
│   ├── background/              # 后台 service worker
│   │   ├── index.ts             # 主入口 + 消息路由 + spaces 注册
│   │   ├── native-host.ts       # nativeMessaging 客户端
│   │   ├── orchestrator.ts      # Roost → Pulse → Briefing 编排
│   │   ├── roost.ts             # 邮件 / 联系人聚合
│   │   ├── pulse.ts             # ContactPulse + Briefing LLM 调用
│   │   ├── compose.ts           # 撰写窗口预填
│   │   └── store.ts             # browser.storage.local 封装
│   ├── shared/protocol.ts       # 扩展 ↔ host 共用类型
│   ├── ui/                      # React UI
│   └── icons/
├── native-host/                 # Native Messaging Host (Node)
│   ├── index.mjs                # stdio 协议主循环
│   ├── cli.mjs                  # CLI 探测 + spawn
│   └── protocol.mjs             # 4-byte length-prefix 帧编解码
├── scripts/
│   ├── build.mjs                # esbuild + zip XPI
│   └── install-native-host.mjs  # 跨平台 NMH 安装器
├── PRD.md
├── Mockup.html
└── README.md
```

### 实施进度

参考 PRD §8 的实施顺序：

- [x] manifest + 最小 MailExtension（AI 视图标签页）
- [x] Native Messaging Host + CLI spawn
- [x] Roost：枚举本地邮件 + 通讯录 + 联系人聚合
- [x] ContactPulse + Briefing LLM 调用 + 流式输出
- [x] UI 落地（CLI Picker / Intro / Loading / Briefing）
- [x] 撰写窗口预填
- [ ] 日历集成（API 在 TB 140 仍部分实验性）
- [ ] Rubric 文件（AI 持续维护的判定标准）
- [ ] 设置面板（CLI 切换、清除数据、自我介绍编辑）
- [ ] 触发器：新邮件到达自动跑增量分析
- [ ] 跨平台一键安装器 (.pkg / .msi / .deb)

## 设计取舍 / 不做的事

参考 [PRD §9](./PRD.md#9-v1-明确不做)。要点：

- ❌ 不接云 API、不收 API key（必须本地 CLI）
- ❌ 不自动发送邮件（永远在撰写窗口 + 用户审核）
- ❌ 不解析附件、不清洗正文（v1 直接送给 LLM）
- ❌ 不自动建联系人（避免污染通讯簿）
- ❌ 不并发调用 CLI（先假设串行）

## 相关项目

- [CCCPlayer](https://github.com/pekinlcc/CCCPlayer) —— 同作者的另一个项目，验证了把 Claude Code CLI 当模型后端的做法

## License

待定（暂时仅作 alpha 测试用）
