import { useEffect, useState } from 'react';
import { tbStyles } from '../styles';
import { SparkleIcon } from '../icons';
import type {
  BriefingItem,
  EmailPreview,
  Pipeline,
  SuggestedAction,
  SuggestedActionKind,
} from '../../shared/protocol';
import { ui } from '../messaging';

// ─── 按 kind 渲染动作按钮 ───────────────────────────────────────────
const KIND_STYLES: Record<
  SuggestedActionKind,
  { color: string; bg: string; bgLight: string; icon: string; label: string }
> = {
  reply: {
    color: '#1373D9',
    bg: '#E8F1FB',
    bgLight: '#F4F9FF',
    icon: '💬',
    label: '回复',
  },
  calendar: {
    color: '#2A8B3F',
    bg: '#E7F5EC',
    bgLight: '#F2FAF5',
    icon: '📅',
    label: '加日历',
  },
  task: {
    color: '#6B4B8E',
    bg: '#EFE9F5',
    bgLight: '#F8F5FB',
    icon: '☑',
    label: '加任务',
  },
  acknowledge: {
    color: '#A37911',
    bg: '#FEF8E7',
    bgLight: '#FFFBED',
    icon: '✓',
    label: '已读+归档',
  },
};

function ActionButton({
  action,
  running,
  disabled,
  onClick,
}: {
  action: SuggestedAction;
  running: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const kind = (action.kind ?? 'reply') as SuggestedActionKind;
  const s = KIND_STYLES[kind];
  return (
    <button
      onClick={onClick}
      disabled={disabled || running}
      title={`${s.label}动作`}
      style={{
        padding: '7px 12px',
        fontSize: 12,
        background: running ? s.bg : '#FFF',
        color: s.color,
        border: `1px solid ${s.color}`,
        borderRadius: 5,
        cursor: disabled ? 'not-allowed' : 'pointer',
        font: 'inherit',
        opacity: disabled ? 0.45 : 1,
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span style={{ fontSize: 11 }}>{s.icon}</span>
      <span>{running ? '处理中…' : action.label}</span>
    </button>
  );
}

function ActionsBox({
  item,
  running,
  actionError,
  generated,
  busy,
  onRunReply,
  onRunCalendar,
  onRunTask,
  onAck,
  onOpenCompose,
  onCopyGenerated,
}: {
  item: BriefingItem;
  running: string | null;
  actionError: string | null;
  generated: { actionLabel: string; text: string } | null;
  busy: boolean;
  onRunReply: (label: string) => void;
  onRunCalendar: (label: string) => void;
  onRunTask: (label: string) => void;
  onAck: () => void;
  onOpenCompose: () => void;
  onCopyGenerated: () => void;
}) {
  // Pulse agent 直接输出 kind=acknowledge 的动作，UI 不再合成
  const displayActions: SuggestedAction[] = item.suggestedActions;

  if (displayActions.length === 0) {
    return (
      <div
        style={{
          background: '#FBFBFC',
          border: `1px solid ${tbStyles.borderSoft}`,
          borderRadius: 8,
          padding: '12px 16px',
          fontSize: 12.5,
          color: tbStyles.textMuted,
          marginBottom: 14,
        }}
      >
        无需操作。
      </div>
    );
  }

  function handleClick(action: SuggestedAction) {
    const kind = action.kind ?? 'reply';
    if (kind === 'reply') onRunReply(action.label);
    else if (kind === 'calendar') onRunCalendar(action.label);
    else if (kind === 'task') onRunTask(action.label);
    else if (kind === 'acknowledge') onAck();
  }

  return (
    <div
      style={{
        border: `1px solid ${tbStyles.borderSoft}`,
        borderRadius: 8,
        marginBottom: 14,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${tbStyles.borderSoft}`,
          background: '#FFF',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ color: tbStyles.blue, display: 'inline-flex' }}>
          <SparkleIcon size={13} color={tbStyles.blue} />
        </span>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: tbStyles.blue,
            textTransform: 'uppercase',
            letterSpacing: '.04em',
          }}
        >
          建议处置方式
        </span>
        <span
          style={{ fontSize: 11, color: tbStyles.textFaint, marginLeft: 'auto' }}
        >
          点击执行 · 颜色按动作类型区分
        </span>
      </div>
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {displayActions.map((action, i) => (
          <ActionButton
            key={`${action.label}-${i}`}
            action={action}
            running={running === action.label}
            disabled={(running !== null || busy) && running !== action.label}
            onClick={() => handleClick(action)}
          />
        ))}
      </div>
      {(generated || actionError) && (
        <div
          style={{
            borderTop: `1px solid ${tbStyles.borderSoft}`,
            background: '#FBFBFC',
          }}
        >
          {actionError && (
            <div style={{ padding: '12px 16px', color: '#C44A2C', fontSize: 12 }}>
              出错：{actionError}
            </div>
          )}
          {generated && (
            <>
              <div
                style={{
                  padding: '8px 16px',
                  fontSize: 11,
                  color: tbStyles.textMuted,
                  borderBottom: `1px solid ${tbStyles.borderSoft}`,
                }}
              >
                基于 "{generated.actionLabel}" 生成的回复
              </div>
              <div
                style={{
                  padding: '14px 16px',
                  fontSize: 13,
                  lineHeight: 1.65,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {generated.text}
              </div>
              <div
                style={{
                  padding: '8px 12px',
                  borderTop: `1px solid ${tbStyles.borderSoft}`,
                  display: 'flex',
                  gap: 8,
                  background: '#FFF',
                }}
              >
                <button
                  onClick={onOpenCompose}
                  disabled={busy}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    background: tbStyles.blue,
                    color: '#FFF',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    font: 'inherit',
                  }}
                >
                  在撰写窗口打开
                </button>
                <button
                  onClick={onCopyGenerated}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    background: '#FFF',
                    color: tbStyles.text,
                    border: `1px solid ${tbStyles.border}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    font: 'inherit',
                  }}
                >
                  复制
                </button>
                <button
                  onClick={() => onRunReply(generated.actionLabel)}
                  disabled={running !== null}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    background: '#FFF',
                    color: tbStyles.text,
                    border: `1px solid ${tbStyles.border}`,
                    borderRadius: 4,
                    cursor: running !== null ? 'not-allowed' : 'pointer',
                    font: 'inherit',
                  }}
                >
                  重新生成
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────
type ToastKind = 'success' | 'warning' | 'error';
type Toast = { id: number; kind: ToastKind; text: string };

function ToastView({
  toast,
  onClose,
}: {
  toast: Toast;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [toast.id, onClose]);

  const palette =
    toast.kind === 'success'
      ? { bg: '#1F3A2A', fg: '#A7E3B6', icon: '✓' }
      : toast.kind === 'warning'
      ? { bg: '#3A2D1F', fg: '#F0C97A', icon: '⚠' }
      : { bg: '#3A1F1F', fg: '#F0A7A7', icon: '✗' };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 1000,
        background: palette.bg,
        color: palette.fg,
        borderRadius: 8,
        padding: '10px 14px',
        boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 460,
        fontSize: 12.5,
        fontFamily: tbStyles.font,
        animation: 'tcToastIn 180ms ease-out',
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{palette.icon}</span>
      <span style={{ flex: 1, lineHeight: 1.5 }}>{toast.text}</span>
      <button
        onClick={onClose}
        aria-label="关闭"
        style={{
          background: 'transparent',
          color: palette.fg,
          border: 'none',
          cursor: 'pointer',
          fontSize: 14,
          padding: '0 4px',
          opacity: 0.7,
        }}
      >
        ×
      </button>
      <style>{`
        @keyframes tcToastIn {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function WhatHappenedSection({ item }: { item: BriefingItem }) {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 切换 item 时重置
  useEffect(() => {
    setExpanded(false);
    setPreview(null);
    setError(null);
  }, [item.id]);

  const messageId = item.emailIds[0];
  const canExpand = typeof messageId === 'number';

  async function toggle() {
    if (!canExpand) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (preview || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await ui.getEmailPreview(messageId!);
      if (res.ok && res.preview) setPreview(res.preview);
      else setError(res.error || '加载失败');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function openOriginal() {
    if (!canExpand) return;
    const res = await ui.openOriginal(messageId!);
    if (!res.ok) console.warn('openOriginal:', res.error);
  }

  return (
    <div
      style={{
        background: '#FBFBFC',
        border: `1px solid ${tbStyles.borderSoft}`,
        borderRadius: 8,
        marginBottom: 14,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={toggle}
        style={{
          padding: '14px 16px',
          cursor: canExpand ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: tbStyles.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '.04em',
              marginBottom: 8,
            }}
          >
            发生了什么
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>{item.summary}</div>
        </div>
        {canExpand && (
          <div
            style={{
              fontSize: 11,
              color: tbStyles.blue,
              flexShrink: 0,
              padding: '4px 8px',
              borderRadius: 4,
              background: expanded ? tbStyles.blueLight : 'transparent',
            }}
          >
            {expanded ? '收起 ▲' : '查看原邮件 ▼'}
          </div>
        )}
      </div>

      {expanded && (
        <div
          style={{
            borderTop: `1px solid ${tbStyles.borderSoft}`,
            background: '#FFF',
            padding: '14px 16px',
            fontSize: 12.5,
            color: tbStyles.text,
            lineHeight: 1.6,
          }}
        >
          {loading && (
            <div style={{ color: tbStyles.textMuted, fontSize: 12 }}>正在读取邮件…</div>
          )}
          {error && (
            <div style={{ color: '#C44A2C', fontSize: 12 }}>读取失败：{error}</div>
          )}
          {preview && (
            <>
              <div
                style={{
                  fontSize: 11.5,
                  color: tbStyles.textMuted,
                  marginBottom: 8,
                  display: 'grid',
                  gridTemplateColumns: '52px 1fr',
                  rowGap: 3,
                }}
              >
                <span style={{ color: tbStyles.textFaint }}>主题</span>
                <span style={{ color: tbStyles.text, fontWeight: 500 }}>{preview.subject}</span>
                <span style={{ color: tbStyles.textFaint }}>来自</span>
                <span>{preview.from}</span>
                <span style={{ color: tbStyles.textFaint }}>时间</span>
                <span>{new Date(preview.date).toLocaleString()}</span>
              </div>
              <div
                style={{
                  borderTop: `1px solid ${tbStyles.borderSoft}`,
                  paddingTop: 10,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'inherit',
                  maxHeight: 320,
                  overflow: 'auto',
                }}
              >
                {preview.bodyText || <span style={{ color: tbStyles.textFaint }}>(正文为空)</span>}
              </div>
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={openOriginal}
                  style={{
                    fontSize: 11.5,
                    padding: '5px 12px',
                    background: tbStyles.blue,
                    color: '#FFF',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  在 Thunderbird 中打开 →
                </button>
              </div>
              {item.emailIds.length > 1 && (
                <div
                  style={{
                    fontSize: 11,
                    color: tbStyles.textMuted,
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: `1px dashed ${tbStyles.borderSoft}`,
                  }}
                >
                  此事项关联 {item.emailIds.length} 封邮件，这里只显示最近一封。点 "在 Thunderbird 中打开" 查看全部。
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PriorityPill({ priority }: { priority: BriefingItem['priority'] }) {
  const map = {
    high: { bg: '#FEF1ED', fg: '#C44A2C', label: '高' },
    medium: { bg: '#FEF8E7', fg: '#A37911', label: '中' },
    low: { bg: '#F1F1F4', fg: '#6B6B6B', label: '低' },
  } as const;
  const m = map[priority];
  return (
    <span
      style={{
        fontSize: 10.5,
        padding: '1px 7px',
        borderRadius: 3,
        background: m.bg,
        color: m.fg,
        fontWeight: 600,
        letterSpacing: '.02em',
      }}
    >
      {m.label}
    </span>
  );
}

function Avatar({ char, color, size = 28 }: { char: string; color: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        color: '#FFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {char}
    </div>
  );
}

function btnStyle(kind: 'primary' | 'ghost' | 'ghost-subtle'): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '7px 14px',
    fontSize: 12.5,
    fontWeight: 500,
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    border: 'none',
    whiteSpace: 'nowrap',
  };
  if (kind === 'primary') return { ...base, background: tbStyles.blue, color: '#FFF' };
  if (kind === 'ghost')
    return { ...base, background: '#FFF', color: tbStyles.text, border: `1px solid ${tbStyles.border}` };
  return { ...base, background: 'transparent', color: tbStyles.textMuted };
}

function ProgressBanner({
  pipeline,
  unscanned,
}: {
  pipeline: Pipeline;
  unscanned: number;
}) {
  if (pipeline.phase === 'pulse') {
    return (
      <div
        style={{
          padding: '8px 16px',
          background: tbStyles.blueLight,
          borderBottom: `1px solid ${tbStyles.borderSoft}`,
          fontSize: 11.5,
          color: '#0A4D8F',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: tbStyles.blue,
            animation: 'tbpulse 1.2s ease-in-out infinite',
          }}
        />
        <span style={{ flex: 1 }}>
          正在分析（{pipeline.processed}/{pipeline.total}）
          {pipeline.current ? `· ${pipeline.current}` : ''}
        </span>
        <style>{`@keyframes tbpulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
      </div>
    );
  }
  if (pipeline.phase === 'briefing') {
    return (
      <div
        style={{
          padding: '8px 16px',
          background: tbStyles.blueLight,
          borderBottom: `1px solid ${tbStyles.borderSoft}`,
          fontSize: 11.5,
          color: '#0A4D8F',
        }}
      >
        正在合并简报…
      </div>
    );
  }
  if (pipeline.phase === 'done' && unscanned > 0) {
    return null; // 用户在 footer 上能看到 "扫描更多"
  }
  if (pipeline.phase === 'error') {
    return (
      <div
        style={{
          padding: '8px 16px',
          background: '#FEF1ED',
          borderBottom: `1px solid #F5C9BC`,
          fontSize: 11.5,
          color: '#C44A2C',
        }}
      >
        分析失败：{pipeline.message}
      </div>
    );
  }
  return null;
}

export function BriefingScreen({
  items,
  finishedAt,
  pipeline,
  unscannedContacts,
  onRerun,
  onScanMore,
}: {
  items: BriefingItem[];
  finishedAt: number | null;
  pipeline: Pipeline;
  unscannedContacts: number;
  onRerun: () => void;
  onScanMore: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const item = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const isAnalyzing = pipeline.phase === 'pulse' || pipeline.phase === 'briefing';

  function showToast(kind: ToastKind, text: string) {
    setToast({ id: Date.now(), kind, text });
  }

  if (!item) {
    // 没卡片：分析中显示 loading 文案，否则显示空态
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FFF',
          padding: 32,
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            margin: '0 auto 16px',
            borderRadius: 16,
            background: 'linear-gradient(135deg, #E8F1FB 0%, #DDE9F8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isAnalyzing ? (
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                border: `3px solid ${tbStyles.blue}`,
                borderTopColor: 'transparent',
                animation: 'tbspin 0.9s linear infinite',
              }}
            />
          ) : (
            <svg width="30" height="30" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8.5l3 3 7-7"
                stroke={tbStyles.blue}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 6px' }}>
          {isAnalyzing ? '正在分析中…' : '今日无重要事项'}
        </h2>
        <p
          style={{
            fontSize: 13,
            color: tbStyles.textMuted,
            margin: 0,
            lineHeight: 1.55,
            textAlign: 'center',
          }}
        >
          {isAnalyzing
            ? pipeline.phase === 'pulse'
              ? `已处理 ${pipeline.processed}/${pipeline.total}，重要事项会逐个冒出来`
              : '正在合并简报…'
            : 'AI 没有找到需要立即回复或处理的事情。'}
        </p>
        {!isAnalyzing && (
          <button onClick={onRerun} style={{ ...btnStyle('ghost'), marginTop: 20 }}>
            重新分析
          </button>
        )}
        <style>{`
          @keyframes tbspin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  async function ack() {
    if (!item) return;
    setBusy(true);
    try {
      const res = await ui.acknowledge(item.id);
      const a = res.archive;
      if (!a) {
        // 没邮件 ID 关联，单纯标记 dismissed
        showToast('success', '已从简报移除');
      } else if (a.errors.length === 0) {
        showToast(
          'success',
          `已标为已读 · 归档 ${a.archived} 封${a.marked !== a.archived ? `（标读 ${a.marked} 封）` : ''}`,
        );
      } else if (a.archived === 0) {
        showToast('warning', `已标读 ${a.marked} 封，但归档失败：${a.errors[0]}`);
      } else {
        showToast(
          'warning',
          `归档了 ${a.archived} 封，${a.errors.length} 封出错（${a.errors[0]}）`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function mute() {
    if (!item) return;
    setBusy(true);
    try {
      await ui.muteThread(item.id);
      showToast('success', '已压制此 thread · 不会再提示');
    } finally {
      setBusy(false);
    }
  }

  // 当前选中的卡里：用户点过的动作 label + AI 写出的回复正文
  const [generated, setGenerated] = useState<{
    actionLabel: string;
    text: string;
  } | null>(null);
  // 正在跑哪个 action（label 唯一定位）+ 错误
  const [running, setRunning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // item 切换时清掉跨 item 的状态
  useEffect(() => {
    setGenerated(null);
    setRunning(null);
    setActionError(null);
  }, [item?.id]);

  async function runReplyAction(actionLabel: string) {
    if (!item) return;
    setRunning(actionLabel);
    setActionError(null);
    try {
      const res = await ui.generateReply(item.id, actionLabel);
      if (res.ok && res.text) {
        setGenerated({ actionLabel, text: res.text });
      } else {
        setActionError(res.error || '生成失败');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  }

  async function runCalendarAction(actionLabel: string) {
    if (!item) return;
    setRunning(actionLabel);
    setActionError(null);
    try {
      const res = await ui.createCalendarEvent(item.id, actionLabel);
      if (res.ok && res.result) {
        showToast('success', `✓ ${res.result.detail}`);
      } else {
        const msg = res.result?.detail || res.error || '创建失败';
        showToast('error', `日历创建失败：${msg}`);
      }
    } catch (err) {
      showToast('error', `日历创建失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(null);
    }
  }

  async function runTaskAction(actionLabel: string) {
    if (!item) return;
    setRunning(actionLabel);
    setActionError(null);
    try {
      const res = await ui.createTask(item.id, actionLabel);
      if (res.ok && res.result) {
        showToast('success', `✓ ${res.result.detail}`);
      } else {
        const msg = res.result?.detail || res.error || '创建失败';
        showToast('error', `任务创建失败：${msg}`);
      }
    } catch (err) {
      showToast('error', `任务创建失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(null);
    }
  }

  async function openComposeWithGenerated() {
    if (!item || !generated) return;
    setBusy(true);
    try {
      const res = await ui.openCompose(item.id, generated.text);
      if (!res.ok) {
        showToast('error', `打开撰写窗口失败：${res.error || '未知错误'}`);
      }
      // 成功不弹 toast——TB 会真的开撰写窗口，那就是反馈
    } finally {
      setBusy(false);
    }
  }

  async function copyGenerated() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.text);
      showToast('success', '已复制到剪贴板');
    } catch (err) {
      showToast('error', `复制失败：${err instanceof Error ? err.message : String(err)}`);
      console.warn('clipboard:', err);
    }
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#FFF',
      }}
    >
      <ProgressBanner pipeline={pipeline} unscanned={unscannedContacts} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '320px 1fr',
        }}
      >
      <div
        style={{
          borderRight: `1px solid ${tbStyles.borderSoft}`,
          display: 'flex',
          flexDirection: 'column',
          background: '#FBFBFC',
          minHeight: 0, // 关键：让内部 flex:1 + overflow:auto 真的能滚
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${tbStyles.borderSoft}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>今日简报</span>
            <button
              onClick={onRerun}
              disabled={isAnalyzing}
              style={{
                fontSize: 11,
                padding: '3px 9px',
                background: '#FFF',
                border: `1px solid ${tbStyles.border}`,
                borderRadius: 4,
                cursor: isAnalyzing ? 'wait' : 'pointer',
                color: tbStyles.text,
                opacity: isAnalyzing ? 0.6 : 1,
              }}
            >
              重新分析
            </button>
          </div>
          <div style={{ fontSize: 11, color: tbStyles.textMuted, marginTop: 2 }}>
            {items.length} 项{' '}
            {pipeline.phase === 'done' && finishedAt
              ? `· 完成于 ${new Date(finishedAt).toLocaleTimeString()}`
              : isAnalyzing
              ? '· 仍在分析'
              : ''}
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {items.map((it) => (
            <div
              key={it.id}
              onClick={() => setSelectedId(it.id)}
              style={{
                padding: '10px 16px',
                borderBottom: `1px solid ${tbStyles.borderSoft}`,
                background: selectedId === it.id ? tbStyles.select : 'transparent',
                cursor: 'pointer',
                borderLeft:
                  selectedId === it.id
                    ? `3px solid ${tbStyles.blue}`
                    : '3px solid transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <Avatar char={it.contactAvatar} color={it.contactColor} size={20} />
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {it.contactName}
                </span>
                <PriorityPill priority={it.priority} />
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  marginBottom: 2,
                  color: tbStyles.text,
                  lineHeight: 1.35,
                }}
              >
                {it.title}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: tbStyles.textMuted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  lineHeight: 1.45,
                }}
              >
                {it.summary}
              </div>
              {it.deadline && it.priority === 'high' && (
                <div
                  style={{
                    fontSize: 10.5,
                    color: '#C44A2C',
                    marginTop: 4,
                    fontWeight: 500,
                  }}
                >
                  ⏱ {it.deadline}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '16px 28px',
            borderBottom: `1px solid ${tbStyles.borderSoft}`,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexShrink: 0,
          }}
        >
          <Avatar char={item.contactAvatar} color={item.contactColor} size={42} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{item.contactName}</span>
              <PriorityPill priority={item.priority} />
            </div>
            <div style={{ fontSize: 11.5, color: tbStyles.textMuted }}>{item.contactEmail}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px', lineHeight: 1.3 }}>
            {item.title}
          </h2>
          {item.deadline && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11.5,
                padding: '3px 9px',
                borderRadius: 4,
                background: item.priority === 'high' ? '#FEF1ED' : '#FEF8E7',
                color: item.priority === 'high' ? '#C44A2C' : '#A37911',
                fontWeight: 500,
                marginBottom: 18,
              }}
            >
              ⏱ {item.deadline}
            </div>
          )}

          <WhatHappenedSection item={item} />

          {/* 建议处置方式：所有动作（reply / calendar / task / 我已知晓）都在这一个卡里
               点击后视 kind 走不同处理路径 */}
          <ActionsBox
            item={item}
            running={running}
            actionError={actionError}
            generated={generated}
            busy={busy}
            onRunReply={runReplyAction}
            onRunCalendar={runCalendarAction}
            onRunTask={runTaskAction}
            onAck={ack}
            onOpenCompose={openComposeWithGenerated}
            onCopyGenerated={copyGenerated}
          />

          {item.reason && (
            <div
              style={{
                background: tbStyles.blueLight,
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 18,
                display: 'flex',
                gap: 8,
              }}
            >
              <span style={{ color: tbStyles.blue, flexShrink: 0, fontSize: 14 }}>💡</span>
              <div style={{ fontSize: 12.5, color: '#0A4D8F', lineHeight: 1.55 }}>
                <strong>AI 的判断依据：</strong> {item.reason}
              </div>
            </div>
          )}

          {/* 底部只剩 secondary 动作。"我已知晓" 已并入 ActionsBox 里 */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={mute}
              disabled={busy}
              style={{ ...btnStyle('ghost-subtle'), padding: '7px 12px', fontSize: 12 }}
            >
              不重要 · 不再提示
            </button>
          </div>
        </div>
      </div>
      </div>
      {pipeline.phase === 'done' && unscannedContacts > 0 && (
        <div
          style={{
            padding: '8px 16px',
            background: '#FBFBFC',
            borderTop: `1px solid ${tbStyles.borderSoft}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 11.5,
            color: tbStyles.textMuted,
          }}
        >
          <span style={{ flex: 1 }}>
            还有 {unscannedContacts} 个联系人未扫描（首次只看 top 50）
          </span>
          <button onClick={onScanMore} style={btnStyle('ghost')}>
            扫描更多
          </button>
        </div>
      )}
      {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
