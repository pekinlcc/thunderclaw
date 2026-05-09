// Protocol shared between extension and native host.
// Wire format is defined in native-host/protocol.mjs (length-prefixed JSON).

export type CLIInfo = {
  installed: boolean;
  loggedIn: boolean;
  path?: string;
  version?: string;
};

export type ProbeResult = {
  claude: CLIInfo;
  codex: CLIInfo;
};

export type ClaudeCallParams = {
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
};

export type ClaudeCallResult = {
  text: string;
};

export type LLMCallParams = ClaudeCallParams & {
  engine: 'claude' | 'codex';
};

export type HostInfo = {
  version: string;        // native host 包的版本，例 "0.1.18"
  protocolVersion: number; // 仅在 NMH 方法集变更时 bump
};

// 扩展期望的 NMH 协议版本——比这个低就提示用户重装 native host。
//   1 = pre-v0.1.15（只有 claude-call）
//   2 = v0.1.15（加 llm-call、去 claude-call）
//   3 = v0.1.18（加 host-info）
//   4 = v0.1.20（加 open-calendar-ics —— TB 弹原生导入对话框）
//   5 = v0.4.0（加 direct-calendar-create —— SQLite 直写，无对话框）
export const EXPECTED_PROTOCOL_VERSION = 5;

export type OpenCalendarICSParams = { ics: string };
export type OpenCalendarICSResult = { ok: boolean };

// 直写 TB 本地日历 SQLite，**不弹导入对话框**。
// AMO unlisted 签名不允许 experiment_apis，所以 v0.4.0 改走 native host 直接 INSERT
// 到 <profile>/calendar-data/local.sqlite。
export type DirectCalendarParams = {
  type: 'event' | 'task';
  title: string;
  startISO?: string;
  endISO?: string;
  dueISO?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
};
export type DirectCalendarResult = {
  ok: boolean;
  calendarId: string;
  calendarName: string;
  itemId: string;
};

export type NativeRequest =
  | { id: string; method: 'ping'; params: Record<string, never> }
  | { id: string; method: 'host-info'; params: Record<string, never> }
  | { id: string; method: 'probe-cli'; params: Record<string, never> }
  | { id: string; method: 'llm-call'; params: LLMCallParams }
  | { id: string; method: 'open-calendar-ics'; params: OpenCalendarICSParams }
  | { id: string; method: 'direct-calendar-create'; params: DirectCalendarParams };

export type NativeResponse<T = unknown> =
  | { id: string; result: T }
  | { id: string; error: { message: string } };

// UI <-> background message types
export type UIRequest =
  | { kind: 'ui:probe-cli' }
  | { kind: 'ui:get-state' }
  | { kind: 'ui:set-cli'; cli: 'claude' | 'codex' }
  | { kind: 'ui:save-intro'; intro: string }
  | { kind: 'ui:start-pipeline' }
  | { kind: 'ui:scan-more' }
  | { kind: 'ui:acknowledge'; itemId: string }
  | { kind: 'ui:mute-thread'; itemId: string }
  | { kind: 'ui:generate-reply'; itemId: string; actionLabel: string }
  | { kind: 'ui:open-compose'; itemId: string; replyText: string; replyAll?: boolean }
  | { kind: 'ui:create-calendar-event'; itemId: string; actionLabel: string }
  | { kind: 'ui:create-task'; itemId: string; actionLabel: string }
  | { kind: 'ui:get-email-preview'; messageId: number }
  | { kind: 'ui:open-original'; messageId: number }
  | { kind: 'ui:set-auto-recompute'; enabled: boolean };

// Event extractor 输出
export type ExtractedEvent = {
  title: string;
  startISO: string | null;  // null 时无明确开始时间
  endISO: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
};

export type ExtractedTask = {
  title: string;
  dueISO: string | null;
  notes: string | null;
};

// 创建动作的执行结果
export type CreateActionResult = {
  ok: boolean;
  // 实际怎么落地的，决定 UI 怎么显示成功提示
  via: 'native-api' | 'fallback-clipboard' | 'fallback-ics';
  // 给 UI 显示用的简要信息
  detail: string;
  errorMessage?: string;
};

export type EmailPreview = {
  messageId: number;
  subject: string;
  from: string;
  date: string; // ISO
  bodyText: string; // 纯文本，已截断
  bodyTruncated: boolean;
};

export type Pipeline =
  | { phase: 'idle' }
  | { phase: 'roost'; total?: number; processed?: number; message?: string }
  | { phase: 'pulse'; total: number; processed: number; current?: string }
  | { phase: 'briefing' }
  | { phase: 'done'; finishedAt: number }
  | { phase: 'error'; message: string };

// 一个建议动作 = 用户视角的一个"决定"。
// 比如对于"K 年级说明会"邮件：
//   "我要参加" = SuggestedAction { label: "我要参加", steps: [reply, calendar, task] }
//   "我不参加" = SuggestedAction { label: "我不参加", steps: [reply, acknowledge] }
//   "我已知晓" = SuggestedAction { label: "我已知晓", steps: [acknowledge] }
//
// UI 把每个 SuggestedAction 渲染成一个按钮。点击 → 顺序执行内部 steps：
//   非 reply 步骤静默后台跑（toast 提示）
//   reply 步骤永远放最后，生成正文后内联展开等用户审稿 → 在撰写窗口打开
//
// 多步 (≥2 steps) 的按钮带个 ⚙ 角标，点开能用 checkbox 调整哪几步执行。
export type ActionStepKind = 'reply' | 'calendar' | 'task' | 'acknowledge';
export type ActionStep = {
  kind: ActionStepKind;
  // 喂给对应 agent 的 prompt 输入：
  //   - reply 的 detail: 回复方向（如"回复确认参加 + 询问尺寸"）
  //   - calendar 的 detail: 含日期/时间/标题/地点的描述
  //   - task 的 detail: 待办描述
  //   - acknowledge 的 detail: 一般为空，UI 不展示
  detail: string;
};
export type SuggestedAction = {
  label: string; // 用户视角的决定，如"我要参加"
  steps: ActionStep[];
};

// 兼容老数据的 kind 别名
export type SuggestedActionKind = ActionStepKind;

export type BriefingItem = {
  id: string;
  contactName: string;
  contactEmail: string;
  contactAvatar: string;
  contactColor: string;
  title: string;
  summary: string;
  priority: 'high' | 'medium' | 'low';
  deadline: string | null;
  // 由 Pulse agent 一次性输出的所有候选动作。可以混合 reply / calendar / task /
  // acknowledge 多种 kind。空数组表示 "没什么可做的"，UI 会显示一个默认占位。
  suggestedActions: SuggestedAction[];
  reason: string;
  // 与本卡片相关的所有邮件 ID（含发出 + 收到），用于"打开原邮件" / 预览
  emailIds: number[];
  // 仅"收到"的子集；acknowledge 的归档动作只动这部分，不会把用户 Sent 邮件移走
  incomingEmailIds: number[];
  // 回复的目标邮件 ID。
  // 优先取最近一封"收到"的；若整个 thread 全是用户自己发出的（follow-up 场景），
  // 取最近一封 user-sent，并设 replyTargetIsUserSent=true，UI 会用 replyToAll 而不是 replyToSender
  replyToMessageId: number | null;
  replyTargetIsUserSent: boolean;
  threadKey: string;
};

// Native host 的版本握手结果。startup 时 background 调一次 host-info 算出来。
// - 'matched'：版本号 + protocolVersion 对得上，无声放行
// - 'too-old'：host 不认 host-info（pre-v0.1.18）或 protocolVersion 不够 → 红条提示重装
// - 'mismatch'：protocolVersion 够了但 version 字符串不匹配 → 黄条提示建议重装
// - null：还没探完 / 探失败
export type HostHandshake =
  | null
  | { kind: 'matched'; version: string; protocolVersion: number }
  | { kind: 'too-old'; reason: string }
  | { kind: 'mismatch'; hostVersion: string; expectedVersion: string };

export type AppState = {
  // 升级时 store 检测到老版本会丢弃 briefing / acknowledged / muted 等运行时缓存，
  // 但保留 intro / selectedCli 这些用户配置。
  schemaVersion: number;
  cliStatus: ProbeResult | null;
  selectedCli: 'claude' | 'codex' | null;
  intro: string;
  introCompleted: boolean;
  pipeline: Pipeline;
  briefing: BriefingItem[];
  briefingFinishedAt: number | null;
  // Briefing agent 输出的 1-2 句整体概览，例如"今天 12 件待处理；HSBC 入账提醒和家长会
  // 回复最紧急。"。为 null 表示尚未跑过 briefing / briefing 输出 schema 缺失。
  briefingOverview: string | null;
  acknowledged: string[];
  muted: string[];
  // 优先级排队 + 分批扫描状态
  unscannedContacts: number; // 还没扫的 top 50 之外的联系人数
  // 启动时握手的结果——内存态，不持久化（每次重启都 re-probe）
  hostHandshake: HostHandshake;
  // 新邮件到达时是否自动重新分析（只重跑相关联系人的 Pulse + 全量重算 Briefing）。
  // 默认 true。用户在简报顶端可以一键开关。
  autoRecompute: boolean;
};
