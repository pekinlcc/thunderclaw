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

export type NativeRequest =
  | { id: string; method: 'ping'; params: Record<string, never> }
  | { id: string; method: 'probe-cli'; params: Record<string, never> }
  | { id: string; method: 'claude-call'; params: ClaudeCallParams };

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
  | { kind: 'ui:open-original'; messageId: number };

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

// 一个建议动作。所有"用户可以做的事"都统一用 SuggestedAction 表达，
// 由 Pulse agent 一次性输出，UI 只管按 kind 渲染。
//   label = 按钮上的中文短语
//   kind  = 动作类型，决定点击后的处理路径：
//           - 'reply'        → Writer agent 生成回复 → 用户在撰写窗口里发
//           - 'calendar'     → Event extractor 解析时间地点 → 创建日历事件
//           - 'task'         → Task extractor 解析待办 → 创建 Thunderbird 任务
//           - 'acknowledge'  → 标记已读 + 归档 + 从简报移除
export type SuggestedActionKind = 'reply' | 'calendar' | 'task' | 'acknowledge';
export type SuggestedAction = {
  label: string;
  kind?: SuggestedActionKind; // 缺省 'reply' 兼容旧数据
};

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
  emailIds: number[];
  threadKey: string;
};

export type AppState = {
  cliStatus: ProbeResult | null;
  selectedCli: 'claude' | 'codex' | null;
  intro: string;
  introCompleted: boolean;
  pipeline: Pipeline;
  briefing: BriefingItem[];
  briefingFinishedAt: number | null;
  acknowledged: string[];
  muted: string[];
  // 优先级排队 + 分批扫描状态
  unscannedContacts: number; // 还没扫的 top 50 之外的联系人数
};
