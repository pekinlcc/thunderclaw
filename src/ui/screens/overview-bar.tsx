// 简报顶端的总览条：
//   - 总数 + 高/中/低优先级各几个
//   - 1-2 句 LLM 输出的整体概览（briefingOverview）
//   - "新邮件自动重算"开关（toggle 立刻 send 到 background）
// 默认折叠成单行，点开看完整概览。

import { useState } from 'react';
import type { BriefingItem } from '../../shared/protocol';
import { ui } from '../messaging';
import { tbStyles } from '../styles';

type Props = {
  items: BriefingItem[];
  overview: string | null;
  autoRecompute: boolean;
  isAnalyzing: boolean;
};

const PRIORITY_PILL = {
  high:   { fg: '#C44A2C', bg: '#FEF1ED', dot: '#E85D3A', label: '高' },
  medium: { fg: '#A37911', bg: '#FEF8E7', dot: '#E5B23E', label: '中' },
  low:    { fg: '#6B6B6B', bg: '#F1F1F4', dot: '#B0B0B5', label: '低' },
} as const;

export function OverviewBar({ items, overview, autoRecompute, isAnalyzing }: Props) {
  const [expanded, setExpanded] = useState(true);

  const counts = {
    high: items.filter((i) => i.priority === 'high').length,
    medium: items.filter((i) => i.priority === 'medium').length,
    low: items.filter((i) => i.priority === 'low').length,
  };

  // 没简报就不画——避免初始空白屏幕上盖一条空总览
  if (items.length === 0 && !isAnalyzing) return null;

  return (
    <div
      style={{
        background: '#FAFAFB',
        borderBottom: `1px solid ${tbStyles.borderSoft}`,
        padding: '10px 16px',
        flexShrink: 0,
      }}
    >
      {/* 第一行：总数 + 三色 priority pills + 折叠按钮 + auto-recompute 开关 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: tbStyles.text }}>
          📋 今日简报 · {items.length} 件
        </span>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['high', 'medium', 'low'] as const).map((p) => {
            const c = counts[p];
            if (c === 0) return null;
            const s = PRIORITY_PILL[p];
            return (
              <span
                key={p}
                style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  borderRadius: 9,
                  background: s.bg,
                  color: s.fg,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontWeight: 500,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: s.dot,
                    display: 'inline-block',
                  }}
                />
                {s.label} {c}
              </span>
            );
          })}
        </div>

        <span style={{ flex: 1 }} />

        <AutoRecomputeToggle enabled={autoRecompute} />

        {overview && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              background: '#FFF',
              border: `1px solid ${tbStyles.border}`,
              borderRadius: 3,
              cursor: 'pointer',
              color: tbStyles.textMuted,
              font: 'inherit',
            }}
          >
            {expanded ? '收起概览' : '展开概览'}
          </button>
        )}
      </div>

      {/* 第二行：LLM 概览文本（可折叠） */}
      {expanded && overview && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: tbStyles.text,
            paddingLeft: 2,
            paddingRight: 2,
          }}
        >
          {overview}
        </div>
      )}

      {/* 没 overview 但 items > 0 时显示一句简单的统计兜底，避免 LLM schema 漂移用户啥也看不到 */}
      {expanded && !overview && items.length > 0 && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            lineHeight: 1.5,
            color: tbStyles.textMuted,
          }}
        >
          {items.length === 1
            ? '仅 1 件待处理。'
            : `共 ${items.length} 件待处理。下次跑流水线会附上整体判断。`}
        </div>
      )}
    </div>
  );
}

function AutoRecomputeToggle({ enabled }: { enabled: boolean }) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const value = optimistic ?? enabled;

  async function toggle() {
    const next = !value;
    setOptimistic(next);
    try {
      await ui.setAutoRecompute(next);
    } catch (err) {
      // 出错就回滚
      setOptimistic(value);
      console.warn('[ThunderClaw] setAutoRecompute failed:', err);
    }
  }

  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        color: tbStyles.textMuted,
        cursor: 'pointer',
        userSelect: 'none',
      }}
      title="新邮件来时是否自动针对受影响的联系人重跑分析（debounce 30 秒后批量处理）"
    >
      <input
        type="checkbox"
        checked={value}
        onChange={toggle}
        style={{ margin: 0, cursor: 'pointer' }}
      />
      新邮件自动更新
    </label>
  );
}
