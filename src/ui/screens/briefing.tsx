import { useEffect, useState } from 'react';
import { tbStyles } from '../styles';
import { SparkleIcon } from '../icons';
import type { BriefingItem, EmailPreview, Pipeline } from '../../shared/protocol';
import { ui } from '../messaging';

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
  const item = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const isAnalyzing = pipeline.phase === 'pulse' || pipeline.phase === 'briefing';

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
      await ui.acknowledge(item.id);
    } finally {
      setBusy(false);
    }
  }

  async function mute() {
    if (!item) return;
    setBusy(true);
    try {
      await ui.muteThread(item.id);
    } finally {
      setBusy(false);
    }
  }

  async function openCompose() {
    if (!item) return;
    setBusy(true);
    try {
      const res = (await ui.openCompose(item.id)) as { ok: boolean; error?: string };
      if (!res.ok) console.warn('openCompose:', res.error);
    } finally {
      setBusy(false);
    }
  }

  async function copyReply() {
    if (!item) return;
    const res = await ui.copyReply(item.id);
    if (res.ok && res.text) {
      try {
        await navigator.clipboard.writeText(res.text);
      } catch (err) {
        console.warn('clipboard:', err);
      }
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

          {item.suggestedReply ? (
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
                  建议回复
                </span>
              </div>
              <div
                style={{
                  padding: '14px 16px',
                  fontSize: 13,
                  lineHeight: 1.65,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {item.suggestedReply}
              </div>
            </div>
          ) : (
            <div
              style={{
                background: '#FEF8E7',
                border: '1px solid #F2E0A8',
                borderRadius: 8,
                padding: '12px 16px',
                fontSize: 12.5,
                color: '#7A5A11',
                marginBottom: 14,
              }}
            >
              <strong>无需回复。</strong> 这是一封通知类邮件，确认后即可标记为已知晓。
            </div>
          )}

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

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {item.suggestedReply ? (
              <>
                <button
                  onClick={openCompose}
                  disabled={busy}
                  style={{ ...btnStyle('primary'), padding: '7px 16px' }}
                >
                  在撰写窗口打开
                </button>
                <button
                  onClick={copyReply}
                  disabled={busy}
                  style={{ ...btnStyle('ghost'), padding: '7px 14px' }}
                >
                  复制到剪贴板
                </button>
              </>
            ) : (
              <button
                onClick={ack}
                disabled={busy}
                style={{ ...btnStyle('primary'), padding: '7px 16px' }}
              >
                我已知晓
              </button>
            )}
            <div style={{ flex: 1 }} />
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
    </div>
  );
}
