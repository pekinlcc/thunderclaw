import { useEffect, useMemo, useState } from 'react';
import { tbStyles } from '../styles';
import { SparkleIcon } from '../icons';
import type {
  ActionStep,
  ActionStepKind,
  BriefingItem,
  EmailPreview,
  Pipeline,
  SuggestedAction,
  SuggestedActionKind,
} from '../../shared/protocol';
import { ui } from '../messaging';
import { OverviewBar } from './overview-bar';

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

// 把 steps 拼成 emoji 链描述: "💬 回复 · 📅 加日历 · ☑ 加待办"
function stepsSubtitle(steps: ActionStep[]): string {
  return steps.map((s) => `${KIND_STYLES[s.kind].icon} ${KIND_STYLES[s.kind].label}`).join(' · ');
}

// 步骤执行顺序：calendar / task / acknowledge 先（瞬时/后台），reply 永远最后（要等用户审稿）。
function sortStepsForExecution(steps: ActionStep[]): ActionStep[] {
  const order: Record<ActionStepKind, number> = {
    calendar: 0,
    task: 1,
    acknowledge: 2,
    reply: 99,
  };
  return [...steps].sort((a, b) => order[a.kind] - order[b.kind]);
}

const STEP_PROGRESS_MESSAGES: Record<ActionStepKind, string[]> = {
  calendar: [
    '正在读取邮件上下文…',
    '正在请 AI 提取日程字段…',
    '正在等待结构化日程结果…',
  ],
  task: [
    '正在读取邮件上下文…',
    '正在请 AI 提取待办字段…',
    '正在等待结构化任务结果…',
  ],
  reply: [
    '正在读取邮件 thread 和你的自我介绍…',
    '正在请 AI 生成回复草稿…',
    '正在等待草稿返回…',
  ],
  acknowledge: ['正在标记已读并归档…'],
};

function withElapsed(message: string, startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  return seconds >= 3 ? `${message} · ${seconds}s` : message;
}

// 每一步的执行结果（用于内联进度展示）
// 'deferred' 表示这步被推迟到 reply 之后再跑（典型："我不参加 = reply + ack"，
// ack 不能在 reply 之前就跑，否则卡片会被过滤掉、回复正文用户都看不到）
type StepResult = {
  kind: ActionStepKind;
  detail: string;
  state: 'pending' | 'running' | 'done' | 'error' | 'deferred';
  message?: string; // 显示给用户的简要状态文字
};

function IntentButton({
  action,
  isRunning,
  disabled,
  onPrimaryClick,
  onTweakClick,
}: {
  action: SuggestedAction;
  isRunning: boolean;
  disabled: boolean;
  onPrimaryClick: () => void;
  onTweakClick: () => void;
}) {
  const isComposite = action.steps.length >= 2;
  const subtitle = stepsSubtitle(action.steps);
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        border: `1px solid ${tbStyles.blue}`,
        borderRadius: 5,
        background: isRunning ? tbStyles.blueLight : '#FFF',
        opacity: disabled ? 0.5 : 1,
        marginRight: 8,
        marginBottom: 8,
        whiteSpace: 'nowrap',
      }}
    >
      <button
        onClick={onPrimaryClick}
        disabled={disabled || isRunning}
        style={{
          padding: '7px 12px',
          fontSize: 12,
          background: 'transparent',
          color: tbStyles.blue,
          border: 'none',
          borderRadius: '4px 0 0 4px',
          cursor: disabled || isRunning ? 'not-allowed' : 'pointer',
          font: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <span style={{ fontWeight: 500, color: tbStyles.text }}>
            {isRunning ? '执行中…' : action.label}
          </span>
          <span style={{ fontSize: 10.5, color: tbStyles.textMuted, marginTop: 1 }}>
            {subtitle}
          </span>
        </span>
      </button>
      {isComposite && (
        <button
          onClick={onTweakClick}
          disabled={disabled || isRunning}
          title="调整步骤"
          aria-label="调整步骤"
          style={{
            padding: '0 9px',
            background: 'transparent',
            color: tbStyles.blue,
            border: 'none',
            borderLeft: `1px solid ${tbStyles.blue}`,
            borderRadius: '0 4px 4px 0',
            cursor: disabled || isRunning ? 'not-allowed' : 'pointer',
            font: 'inherit',
            fontSize: 13,
            opacity: 0.7,
          }}
        >
          ⚙
        </button>
      )}
    </div>
  );
}

// 展开后的 checkbox 选择面板
function StepsPanel({
  action,
  selected,
  onToggle,
  onSubmit,
  onCancel,
}: {
  action: SuggestedAction;
  selected: boolean[];
  onToggle: (i: number) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const checkedCount = selected.filter(Boolean).length;
  return (
    <div
      style={{
        border: `1px solid ${tbStyles.blue}`,
        borderRadius: 8,
        background: tbStyles.blueLight,
        marginBottom: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${tbStyles.borderSoft}`,
          background: '#FFF',
          fontSize: 12,
          fontWeight: 500,
          color: tbStyles.text,
        }}
      >
        调整 "{action.label}" 的步骤
      </div>
      <div style={{ padding: '8px 14px' }}>
        {action.steps.map((step, i) => {
          const s = KIND_STYLES[step.kind];
          return (
            <label
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '6px 0',
                cursor: 'pointer',
                fontSize: 12.5,
              }}
            >
              <input
                type="checkbox"
                checked={selected[i]}
                onChange={() => onToggle(i)}
                style={{ marginTop: 3, flexShrink: 0 }}
              />
              <span style={{ flex: 1 }}>
                <span style={{ color: s.color, fontWeight: 500 }}>
                  {s.icon} {s.label}
                </span>
                {step.detail && (
                  <span style={{ color: tbStyles.textMuted, marginLeft: 6 }}>
                    {step.detail}
                  </span>
                )}
              </span>
            </label>
          );
        })}
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
          onClick={onSubmit}
          disabled={checkedCount === 0}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            background: checkedCount === 0 ? '#B5B5B5' : tbStyles.blue,
            color: '#FFF',
            border: 'none',
            borderRadius: 4,
            cursor: checkedCount === 0 ? 'not-allowed' : 'pointer',
            font: 'inherit',
          }}
        >
          执行 {checkedCount} 步
        </button>
        <button
          onClick={onCancel}
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
          取消
        </button>
      </div>
    </div>
  );
}

// 进度展示：每一步状态 + reply 步骤的内联生成结果
function ProgressPanel({
  results,
  generated,
  onOpenCompose,
  onCopyGenerated,
  onRegenerate,
  busy,
}: {
  results: StepResult[];
  generated: { detail: string; text: string } | null;
  onOpenCompose: () => void;
  onCopyGenerated: () => void;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const active = results.find((r) => r.state === 'running') ?? null;
  const activeStyle = active ? KIND_STYLES[active.kind] : null;

  return (
    <div
      style={{
        border: `1px solid ${tbStyles.borderSoft}`,
        borderRadius: 8,
        background: '#FBFBFC',
        marginBottom: 12,
        overflow: 'hidden',
      }}
    >
      {active && activeStyle && (
        <div
          style={{
            padding: '8px 14px',
            borderBottom: `1px solid ${tbStyles.borderSoft}`,
            background: tbStyles.blueLight,
            color: '#0A4D8F',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11.5,
            lineHeight: 1.5,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: tbStyles.blue,
              animation: 'tbactionpulse 1.2s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 600, flexShrink: 0 }}>
            {activeStyle.icon} {activeStyle.label}
          </span>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {active.message || '执行中…'}
          </span>
          <style>{`@keyframes tbactionpulse { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>
        </div>
      )}
      <div style={{ padding: '10px 14px' }}>
        {results.map((r, i) => {
          const s = KIND_STYLES[r.kind];
          const icon =
            r.state === 'done' ? '✓' :
            r.state === 'error' ? '✗' :
            r.state === 'running' ? '⏳' :
            r.state === 'deferred' ? '⏸' : '·';
          const color =
            r.state === 'done' ? '#2A8B3F' :
            r.state === 'error' ? '#C44A2C' :
            r.state === 'running' ? tbStyles.blue :
            r.state === 'deferred' ? tbStyles.textMuted : tbStyles.textFaint;
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                padding: '4px 0',
                color: r.state === 'pending' ? tbStyles.textFaint : tbStyles.text,
              }}
            >
              <span style={{ color, width: 14, textAlign: 'center' }}>{icon}</span>
              <span style={{ fontSize: 11 }}>{s.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: s.color, fontWeight: 500 }}>{s.label}</span>
                {r.message && (
                  <span style={{ color: tbStyles.textMuted, marginLeft: 6, overflowWrap: 'anywhere' }}>
                    {r.message}
                  </span>
                )}
                {r.state === 'deferred' && !r.message && (
                  <span style={{ color: tbStyles.textMuted, marginLeft: 6 }}>
                    （回复确认后再执行）
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {generated && (
        <>
          <div
            style={{
              padding: '8px 14px',
              fontSize: 11,
              color: tbStyles.textMuted,
              borderTop: `1px solid ${tbStyles.borderSoft}`,
              background: '#FFF',
            }}
          >
            生成的回复（请检查后再发送）
          </div>
          <div
            style={{
              padding: '12px 14px',
              fontSize: 13,
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: '#FFF',
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
                cursor: busy ? 'wait' : 'pointer',
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
              onClick={onRegenerate}
              disabled={busy}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                background: '#FFF',
                color: tbStyles.text,
                border: `1px solid ${tbStyles.border}`,
                borderRadius: 4,
                cursor: busy ? 'wait' : 'pointer',
                font: 'inherit',
              }}
            >
              重新生成
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ActionsBox({
  item,
  runState,
  generated,
  busy,
  expandedActionIdx,
  expandedSelected,
  onExpand,
  onCloseExpand,
  onToggleStep,
  onRunIntent,
  onOpenCompose,
  onCopyGenerated,
  onRegenerate,
}: {
  item: BriefingItem;
  runState: {
    actionIdx: number;
    results: StepResult[];
    error: string | null;
    done: boolean;
    deferredAckIdx: number | null;
  } | null;
  generated: { detail: string; text: string } | null;
  busy: boolean;
  expandedActionIdx: number | null;
  expandedSelected: boolean[];
  onExpand: (actionIdx: number) => void;
  onCloseExpand: () => void;
  onToggleStep: (i: number) => void;
  // 执行某个 intent。stepIndexes 为 null 时执行全部 steps
  onRunIntent: (actionIdx: number, stepIndexes: number[] | null) => void;
  onOpenCompose: () => void;
  onCopyGenerated: () => void;
  onRegenerate: () => void;
}) {
  const displayActions = item.suggestedActions;

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

  return (
    <div style={{ marginBottom: 14 }}>
      {/* 展开了的 step 调整面板（直接顶到 actions 上方） */}
      {expandedActionIdx !== null && (
        <StepsPanel
          action={displayActions[expandedActionIdx]!}
          selected={expandedSelected}
          onToggle={onToggleStep}
          onSubmit={() => {
            const idx = expandedActionIdx;
            const selectedIdxs = expandedSelected
              .map((v, i) => (v ? i : -1))
              .filter((i) => i >= 0);
            onCloseExpand();
            onRunIntent(idx, selectedIdxs);
          }}
          onCancel={onCloseExpand}
        />
      )}

      {/* intent 按钮组 */}
      <div
        style={{
          border: `1px solid ${tbStyles.borderSoft}`,
          borderRadius: 8,
          background: '#FFF',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '10px 16px',
            borderBottom: `1px solid ${tbStyles.borderSoft}`,
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
            你打算怎么处理
          </span>
          <span
            style={{ fontSize: 11, color: tbStyles.textFaint, marginLeft: 'auto' }}
          >
            点 ⚙ 调整步骤
          </span>
        </div>
        <div style={{ padding: '12px 16px 4px' }}>
          {displayActions.map((action, i) => (
            <IntentButton
              key={`${action.label}-${i}`}
              action={action}
              isRunning={runState?.actionIdx === i && !runState.done}
              disabled={
                (runState !== null && !runState.done && runState.actionIdx !== i) ||
                busy ||
                expandedActionIdx !== null
              }
              onPrimaryClick={() => onRunIntent(i, null)}
              onTweakClick={() => onExpand(i)}
            />
          ))}
        </div>
      </div>

      {/* 执行进度 / 生成的回复区 */}
      {runState && (
        <div style={{ marginTop: 8 }}>
          <ProgressPanel
            results={runState.results}
            generated={generated}
            onOpenCompose={onOpenCompose}
            onCopyGenerated={onCopyGenerated}
            onRegenerate={onRegenerate}
            busy={busy}
          />
          {runState.error && (
            <div
              style={{
                background: '#FEF1ED',
                color: '#C44A2C',
                padding: '8px 14px',
                borderRadius: 6,
                fontSize: 12,
                marginTop: 6,
              }}
            >
              ⚠ {runState.error}
            </div>
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

  const previewMessageIds = useMemo(() => {
    const raw = [
      ...(item.incomingEmailIds ?? []),
      item.replyToMessageId,
      ...(item.emailIds ?? []),
    ];
    const seen = new Set<number>();
    const ids: number[] = [];
    for (const id of raw) {
      if (typeof id !== 'number' || !Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }, [item.emailIds, item.incomingEmailIds, item.replyToMessageId]);
  const canExpand = previewMessageIds.length > 0;

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
      const errors: string[] = [];
      for (const id of previewMessageIds) {
        const res = await ui.getEmailPreview(id);
        if (res.ok && res.preview) {
          setPreview(res.preview);
          return;
        }
        if (res.error) errors.push(res.error);
      }
      const uniqueErrors = [...new Set(errors)];
      setError(uniqueErrors.length > 0 ? uniqueErrors.join('；') : '没有可读取的原邮件');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function openOriginal() {
    if (!canExpand) return;
    const id = preview?.messageId ?? previewMessageIds[0];
    if (typeof id !== 'number') return;
    const res = await ui.openOriginal(id);
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
                  此事项关联 {item.emailIds.length} 封邮件，这里优先显示最近一封收到邮件。点 "在 Thunderbird 中打开" 查看原邮件。
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
  overview,
  autoRecompute,
  finishedAt,
  pipeline,
  unscannedContacts,
  onRerun,
  onScanMore,
}: {
  items: BriefingItem[];
  overview: string | null;
  autoRecompute: boolean;
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

  // ─── intent 执行状态 ──────────────────────────────
  // 用户点过哪一组 intent，每一步的状态如何
  // done=true 表示这次 run 已经跑完（成功或失败），结果还展示着但按钮不再"执行中"
  // deferredAckIdx 是被推迟的 acknowledge 步在 results 里的 index，等用户对 reply
  // 作出最终动作时再跑（见 splitDeferredAck）；没有推迟则为 null
  const [runState, setRunState] = useState<{
    actionIdx: number;
    results: StepResult[];
    error: string | null;
    done: boolean;
    deferredAckIdx: number | null;
  } | null>(null);
  // reply 步骤生成的回复正文（已审稿区域）
  const [generated, setGenerated] = useState<{
    detail: string;
    text: string;
  } | null>(null);
  // 当前展开 ⚙ 调整面板的 actionIdx + 该 intent 各 step 是否选中
  const [expandedActionIdx, setExpandedActionIdx] = useState<number | null>(null);
  const [expandedSelected, setExpandedSelected] = useState<boolean[]>([]);

  // item 切换时清掉跨 item 的状态
  useEffect(() => {
    setRunState(null);
    setGenerated(null);
    setExpandedActionIdx(null);
    setExpandedSelected([]);
  }, [item?.id]);

  function openExpand(actionIdx: number) {
    if (!item) return;
    const action = item.suggestedActions[actionIdx];
    if (!action) return;
    setExpandedActionIdx(actionIdx);
    setExpandedSelected(action.steps.map(() => true));
  }

  function closeExpand() {
    setExpandedActionIdx(null);
    setExpandedSelected([]);
  }

  function toggleStepSelection(i: number) {
    setExpandedSelected((sel) => sel.map((v, j) => (j === i ? !v : v)));
  }

  // 一个 intent 内：是否同时含 reply + acknowledge —— 这种情况下 ack 不能在 reply 之前就跑，
  // 否则 App 那一层根据 acknowledged[] 过滤后会把这张卡从列表里挤掉，
  // BriefingDetail 切到下一张卡 → 那个 useEffect 一清，用户连生成的回复正文都看不到一眼。
  // 解决：从立即执行队列里抽掉 ack，把它存到"待执行"里，等用户对回复作出最终动作（开撰写窗口 / 取消）后再跑。
  function splitDeferredAck(steps: ActionStep[]): {
    immediate: ActionStep[];
    deferredAck: ActionStep | null;
  } {
    const hasReply = steps.some((s) => s.kind === 'reply');
    const ack = steps.find((s) => s.kind === 'acknowledge') ?? null;
    if (hasReply && ack) {
      return {
        immediate: steps.filter((s) => s.kind !== 'acknowledge'),
        deferredAck: ack,
      };
    }
    return { immediate: steps, deferredAck: null };
  }

  // 执行一个 intent 的指定 steps（stepIdxs=null 表示执行全部）
  async function runIntent(actionIdx: number, stepIdxs: number[] | null) {
    if (!item) return;
    const action = item.suggestedActions[actionIdx];
    if (!action) return;
    const selectedSteps =
      stepIdxs === null
        ? action.steps
        : stepIdxs.map((i) => action.steps[i]).filter((s): s is ActionStep => !!s);
    if (selectedSteps.length === 0) return;
    // 排序：calendar/task/acknowledge 先，reply 最后
    const ordered = sortStepsForExecution(selectedSteps);
    // 把"同时有 reply"情况下的 acknowledge 抽出来，等用户审完再跑
    const { immediate: orderedSteps, deferredAck } = splitDeferredAck(ordered);

    // 初始化进度数组 — 全 pending（含被推迟的 ack，UI 上会单独标"待用户处理回复后执行"）
    const initialResults: StepResult[] = [
      ...orderedSteps.map((s) => ({ kind: s.kind, detail: s.detail, state: 'pending' as const })),
      ...(deferredAck
        ? [{ kind: deferredAck.kind, detail: deferredAck.detail, state: 'deferred' as const }]
        : []),
    ];
    setRunState({
      actionIdx,
      results: initialResults,
      error: null,
      done: false,
      deferredAckIdx: deferredAck ? initialResults.length - 1 : null,
    });
    setGenerated(null);
    setBusy(true);

    let progress = [...initialResults];
    function update(i: number, patch: Partial<StepResult>) {
      progress = progress.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      setRunState((rs) => (rs ? { ...rs, results: [...progress] } : rs));
    }

    async function runWithProgress<T>(
      i: number,
      messages: string[],
      task: () => Promise<T>,
    ): Promise<T> {
      const startedAt = Date.now();
      let msgIdx = 0;
      const push = () => {
        const message = messages[Math.min(msgIdx, messages.length - 1)] || '执行中…';
        update(i, { state: 'running', message: withElapsed(message, startedAt) });
      };
      push();
      const timer = window.setInterval(() => {
        msgIdx = Math.min(msgIdx + 1, messages.length - 1);
        push();
      }, 5000);
      try {
        return await task();
      } finally {
        window.clearInterval(timer);
      }
    }

    try {
      for (let i = 0; i < orderedSteps.length; i++) {
        const step = orderedSteps[i]!;
        try {
          if (step.kind === 'calendar') {
            const extracted = await runWithProgress(i, STEP_PROGRESS_MESSAGES.calendar, () =>
              ui.extractCalendarEvent(item.id, step.detail),
            );
            if (!extracted.ok || !extracted.event) {
              const msg = extracted.error || '无法解析出事件信息';
              update(i, { state: 'error', message: msg });
              showToast('error', `日历创建失败：${msg}`);
              continue;
            }
            const res = await runWithProgress(
              i,
              ['已提取日程字段，正在写入 Thunderbird 日历…', '正在确认日历写入结果…'],
              () => ui.commitCalendarEvent(extracted.event!),
            );
            if (res.ok && res.result) {
              update(i, { state: 'done', message: res.result.detail });
              showToast('success', `${KIND_STYLES.calendar.icon} ${res.result.detail}`);
            } else {
              const msg = res.result?.detail || res.error || '创建失败';
              update(i, { state: 'error', message: msg });
              showToast('error', `日历创建失败：${msg}`);
            }
          } else if (step.kind === 'task') {
            const extracted = await runWithProgress(i, STEP_PROGRESS_MESSAGES.task, () =>
              ui.extractTask(item.id, step.detail),
            );
            if (!extracted.ok || !extracted.task) {
              const msg = extracted.error || '无法解析出任务信息';
              update(i, { state: 'error', message: msg });
              showToast('error', `任务创建失败：${msg}`);
              continue;
            }
            const res = await runWithProgress(
              i,
              ['已提取待办字段，正在写入 Thunderbird 任务…', '正在确认任务写入结果…'],
              () => ui.commitTask(extracted.task!),
            );
            if (res.ok && res.result) {
              update(i, { state: 'done', message: res.result.detail });
              showToast('success', `${KIND_STYLES.task.icon} ${res.result.detail}`);
            } else {
              const msg = res.result?.detail || res.error || '创建失败';
              update(i, { state: 'error', message: msg });
              showToast('error', `任务创建失败：${msg}`);
            }
          } else if (step.kind === 'acknowledge') {
            const res = await runWithProgress(i, STEP_PROGRESS_MESSAGES.acknowledge, () =>
              ui.acknowledge(item.id),
            );
            const a = res.archive;
            if (a && a.errors.length === 0) {
              update(i, {
                state: 'done',
                message: `已标读 · 归档 ${a.archived} 封`,
              });
              showToast(
                'success',
                `${KIND_STYLES.acknowledge.icon} 已标已读 · 归档 ${a.archived} 封`,
              );
            } else if (a && a.archived === 0) {
              update(i, { state: 'error', message: `标读 ${a.marked}，归档失败` });
              showToast('warning', `已标读 ${a.marked} 封，归档失败：${a.errors[0]}`);
            } else {
              update(i, { state: 'done', message: '已从简报移除' });
              showToast('success', '已从简报移除');
            }
          } else if (step.kind === 'reply') {
            // reply 永远最后跑：生成正文 → 内联展示 → 等用户审稿后开撰写窗口
            const res = await runWithProgress(i, STEP_PROGRESS_MESSAGES.reply, () =>
              ui.generateReply(item.id, step.detail),
            );
            if (res.ok && res.text) {
              setGenerated({ detail: step.detail, text: res.text });
              update(i, { state: 'done', message: '回复已生成，请检查后发送' });
              showToast('success', `${KIND_STYLES.reply.icon} 回复已生成，请检查`);
            } else {
              update(i, { state: 'error', message: res.error || '生成失败' });
              showToast('error', `回复生成失败：${res.error || '未知错误'}`);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          update(i, { state: 'error', message: msg });
          showToast('error', `${KIND_STYLES[step.kind].label}失败：${msg}`);
          // 单步失败不中断其余步骤——其它步骤继续跑
        }
      }
    } finally {
      setBusy(false);
      // 标记本次 run 已完成（成功或失败），按钮恢复，结果面板还显示
      setRunState((rs) => (rs ? { ...rs, done: true } : rs));
    }
  }

  async function openComposeWithGenerated() {
    if (!item || !generated) return;
    setBusy(true);
    try {
      const res = await ui.openCompose(item.id, generated.text);
      if (!res.ok) {
        showToast('error', `打开撰写窗口失败：${res.error || '未知错误'}`);
        return; // 撰写窗口都没开起来，先不要把卡片归档掉，让用户能再点一次
      }
      // 撰写窗口打开成功是用户对回复的最终动作。如果 intent 含 deferred ack，
      // 现在跑——卡片被过滤的副作用现在发生才合理（用户已经看到草稿了）
      if (runState?.deferredAckIdx != null && !runState.results[runState.deferredAckIdx]?.message) {
        const idx = runState.deferredAckIdx;
        // 标记 running
        setRunState((rs) =>
          rs
            ? {
                ...rs,
                results: rs.results.map((r, i) =>
                  i === idx
                    ? { ...r, state: 'running' as const, message: '正在标记已读并归档…' }
                    : r,
                ),
              }
            : rs,
        );
        try {
          const ar = await ui.acknowledge(item.id);
          const a = ar.archive;
          const okMsg =
            a && a.errors.length === 0
              ? `已标读 · 归档 ${a.archived} 封`
              : a && a.archived === 0
                ? `标读 ${a.marked}，归档失败`
                : '已从简报移除';
          setRunState((rs) =>
            rs
              ? {
                  ...rs,
                  results: rs.results.map((r, i) =>
                    i === idx
                      ? { ...r, state: a && a.archived === 0 ? ('error' as const) : ('done' as const), message: okMsg }
                      : r,
                  ),
                }
              : rs,
          );
          if (a && a.errors.length === 0) {
            showToast('success', `${KIND_STYLES.acknowledge.icon} ${okMsg}`);
          } else if (a && a.archived === 0) {
            showToast('warning', `已标读 ${a.marked} 封，归档失败：${a.errors[0]}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setRunState((rs) =>
            rs
              ? {
                  ...rs,
                  results: rs.results.map((r, i) =>
                    i === idx ? { ...r, state: 'error' as const, message: msg } : r,
                  ),
                }
              : rs,
          );
          showToast('error', `归档失败：${msg}`);
        }
      }
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

  async function regenerateReply() {
    if (!item || !generated) return;
    setBusy(true);
    try {
      const res = await ui.generateReply(item.id, generated.detail);
      if (res.ok && res.text) {
        setGenerated({ detail: generated.detail, text: res.text });
        showToast('success', '已重新生成');
      } else {
        showToast('error', `重新生成失败：${res.error || '未知错误'}`);
      }
    } finally {
      setBusy(false);
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
      <OverviewBar
        items={items}
        overview={overview}
        autoRecompute={autoRecompute}
        isAnalyzing={isAnalyzing}
      />
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

          {/* 建议处置方式：每个 SuggestedAction = 一个用户决定，
               点击触发其内部 steps 顺序执行（calendar/task/ack 先，reply 最后）。
               ⚙ 展开可调整步骤 checkbox。 */}
          <ActionsBox
            item={item}
            runState={runState}
            generated={generated}
            busy={busy}
            expandedActionIdx={expandedActionIdx}
            expandedSelected={expandedSelected}
            onExpand={openExpand}
            onCloseExpand={closeExpand}
            onToggleStep={toggleStepSelection}
            onRunIntent={runIntent}
            onOpenCompose={openComposeWithGenerated}
            onCopyGenerated={copyGenerated}
            onRegenerate={regenerateReply}
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
