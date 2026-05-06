import { tbStyles } from '../styles';
import { SparkleIcon } from '../icons';
import type { Pipeline } from '../../shared/protocol';

const STAGES = [
  { id: 'roost', title: 'Roost · 归集', desc: '聚合本地邮件，按联系人建上下文' },
  { id: 'pulse', title: 'ContactPulse · 逐人分析', desc: '识别每个联系人当前的重要事项（串行）' },
  { id: 'briefing', title: 'Briefing · 汇总', desc: '合并、去重、排出优先级' },
] as const;

function currentIndex(p: Pipeline): number {
  if (p.phase === 'roost') return 0;
  if (p.phase === 'pulse') return 1;
  if (p.phase === 'briefing') return 2;
  if (p.phase === 'done') return 3;
  return -1;
}

function statusOfStage(p: Pipeline, i: number): 'done' | 'running' | 'pending' {
  const cur = currentIndex(p);
  if (i < cur) return 'done';
  if (i === cur) return 'running';
  return 'pending';
}

export function LoadingScreen({ pipeline }: { pipeline: Pipeline }) {
  const headerLine =
    pipeline.phase === 'roost'
      ? pipeline.message ?? '归集中…'
      : pipeline.phase === 'pulse'
      ? `分析 ${pipeline.current ?? '…'}（${pipeline.processed} / ${pipeline.total}）`
      : pipeline.phase === 'briefing'
      ? '正在汇总…'
      : pipeline.phase === 'error'
      ? '出错了'
      : '准备中';

  const subLine =
    pipeline.phase === 'roost' && pipeline.total
      ? `已扫描 ${pipeline.processed ?? 0} / ${pipeline.total} 个文件夹`
      : pipeline.phase === 'pulse'
      ? `串行调用 Claude 中…`
      : pipeline.phase === 'error'
      ? pipeline.message
      : '';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        gridTemplateColumns: '260px 1fr',
        background: '#FBFBFC',
      }}
    >
      <div
        style={{
          padding: '24px 18px',
          borderRight: `1px solid ${tbStyles.borderSoft}`,
          background: '#FFF',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ color: tbStyles.blue }}>
            <SparkleIcon size={14} color={tbStyles.blue} />
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: tbStyles.blue,
              letterSpacing: '.02em',
            }}
          >
            AI 助手
          </span>
        </div>
        <div style={{ fontSize: 13, color: tbStyles.textMuted, marginBottom: 18 }}>
          {pipeline.phase === 'error' ? '分析失败' : '正在分析你的邮件…'}
        </div>

        <div style={{ marginTop: 18 }}>
          {STAGES.map((s, i) => {
            const status = statusOfStage(pipeline, i);
            return (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  marginBottom: 16,
                  position: 'relative',
                }}
              >
                {i < STAGES.length - 1 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 9,
                      top: 22,
                      bottom: -10,
                      width: 2,
                      background: i < currentIndex(pipeline) ? '#3CB371' : '#E0E0E0',
                    }}
                  />
                )}
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: status === 'done' ? '#3CB371' : '#FFF',
                    border:
                      status === 'pending'
                        ? '2px solid #E0E0E0'
                        : status === 'running'
                        ? `2px solid ${tbStyles.blue}`
                        : 'none',
                    flexShrink: 0,
                    zIndex: 1,
                  }}
                >
                  {status === 'done' && (
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M3 8l3 3 7-7"
                        stroke="#FFF"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {status === 'running' && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: tbStyles.blue,
                        animation: 'tbpulse 1.2s ease-in-out infinite',
                      }}
                    />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: status === 'pending' ? tbStyles.textFaint : tbStyles.text,
                    }}
                  >
                    {s.title}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: status === 'pending' ? tbStyles.textFaint : tbStyles.textMuted,
                      marginTop: 1,
                      lineHeight: 1.4,
                    }}
                  >
                    {s.desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 22,
            padding: '10px 12px',
            background: tbStyles.blueLight,
            borderRadius: 7,
            fontSize: 11,
            color: '#0A4D8F',
            lineHeight: 1.5,
          }}
        >
          首次较慢（仅活跃联系人 5–10 分钟）
          <br />
          之后只增量处理新邮件。
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div
          style={{
            padding: '14px 22px',
            borderBottom: `1px solid ${tbStyles.borderSoft}`,
            background: '#FFF',
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{headerLine}</div>
          {subLine && (
            <div style={{ fontSize: 11.5, color: tbStyles.textMuted }}>{subLine}</div>
          )}
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: tbStyles.textMuted,
            fontSize: 13,
          }}
        >
          {pipeline.phase === 'error' ? (
            <div style={{ textAlign: 'center', maxWidth: 480, padding: 24 }}>
              <div style={{ color: '#C44A2C', fontWeight: 600, marginBottom: 8 }}>分析失败</div>
              <div
                style={{
                  fontSize: 12,
                  fontFamily: 'ui-monospace, monospace',
                  background: '#FBFBFC',
                  border: `1px solid ${tbStyles.borderSoft}`,
                  borderRadius: 6,
                  padding: 12,
                  whiteSpace: 'pre-wrap',
                  textAlign: 'left',
                }}
              >
                {pipeline.message}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  border: `3px solid ${tbStyles.borderSoft}`,
                  borderTopColor: tbStyles.blue,
                  borderRadius: '50%',
                  margin: '0 auto 12px',
                  animation: 'tbspin 0.9s linear infinite',
                }}
              />
              处理中…耐心等一下
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes tbpulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes tbspin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
