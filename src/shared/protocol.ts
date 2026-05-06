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
  | { kind: 'ui:open-compose'; itemId: string; replyAll?: boolean }
  | { kind: 'ui:copy-reply'; itemId: string }
  | { kind: 'ui:get-email-preview'; messageId: number }
  | { kind: 'ui:open-original'; messageId: number };

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
  actionType: 'reply' | 'acknowledge' | 'none';
  suggestedReply: string | null;
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
