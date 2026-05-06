import { useEffect, useState } from 'react';
import { tbStyles } from '../styles';
import { ClaudeLogo, CodexLogo, SparkleIcon } from '../icons';
import type { CLIInfo, ProbeResult } from '../../shared/protocol';
import { ui } from '../messaging';

type Status = 'logged-in' | 'not-logged-in' | 'not-installed';

function inferStatus(info: CLIInfo | undefined): Status {
  if (!info || !info.installed) return 'not-installed';
  if (!info.loggedIn) return 'not-logged-in';
  return 'logged-in';
}

function statusMeta(status: Status) {
  switch (status) {
    case 'logged-in':
      return { label: '已登录', desc: '已检测到登录状态', bg: '#E7F5EC', fg: '#2A8B3F' };
    case 'not-logged-in':
      return { label: '未登录', desc: '未检测到登录状态', bg: '#FEF3F0', fg: '#C44A2C' };
    case 'not-installed':
      return { label: '未安装', desc: '未在 PATH 中找到', bg: '#F4F4F4', fg: tbStyles.textMuted };
  }
}

interface CardProps {
  logo: React.ReactNode;
  title: string;
  status: Status;
  version?: string;
  commands: string[];
  onCopy: (cmd: string) => void;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
}

function CLICard({
  logo,
  title,
  status,
  version,
  commands,
  onCopy,
  selectable,
  selected,
  onSelect,
}: CardProps) {
  const meta = statusMeta(status);
  const ringColor = selected ? tbStyles.blue : tbStyles.borderSoft;
  return (
    <div
      onClick={selectable ? onSelect : undefined}
      style={{
        background: '#FFF',
        border: `${selected ? 2 : 1}px solid ${ringColor}`,
        borderRadius: 10,
        padding: selected ? 15 : 16,
        marginBottom: 12,
        cursor: selectable ? 'pointer' : 'default',
        boxShadow: selected ? '0 0 0 3px rgba(19,115,217,0.12)' : 'none',
        transition: 'border-color 120ms, box-shadow 120ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        {selectable && (
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              border: `2px solid ${selected ? tbStyles.blue : tbStyles.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {selected && (
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: tbStyles.blue,
                }}
              />
            )}
          </div>
        )}
        {logo}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 11.5, color: tbStyles.textMuted }}>
            {meta.desc}
            {version ? ` · ${version}` : ''}
          </div>
        </div>
        <div
          style={{
            fontSize: 11,
            padding: '3px 10px',
            borderRadius: 4,
            background: meta.bg,
            color: meta.fg,
            fontWeight: 500,
          }}
        >
          {meta.label}
        </div>
      </div>
      {status !== 'logged-in' &&
        commands.map((cmd, i) => (
          <div
            key={i}
            style={{
              background: '#1A1A1A',
              borderRadius: 6,
              padding: '10px 12px',
              fontFamily: 'ui-monospace, "SF Mono", monospace',
              fontSize: 12,
              color: '#E6E6E6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: i < commands.length - 1 ? 6 : 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span>
              <span style={{ color: '#7AB8FF' }}>$</span> {cmd}
            </span>
            <button
              style={{
                fontSize: 10.5,
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.1)',
                color: '#CCC',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              onClick={() => onCopy(cmd)}
            >
              复制
            </button>
          </div>
        ))}
    </div>
  );
}

export function CLIPickerScreen({
  status,
  selectedCli,
  onContinue,
}: {
  status: ProbeResult | null;
  selectedCli: 'claude' | 'codex' | null;
  onContinue: () => void;
}) {
  const [probing, setProbing] = useState(false);
  const claudeStatus = inferStatus(status?.claude);
  const codexStatus = inferStatus(status?.codex);
  const claudeOk = claudeStatus === 'logged-in';
  const codexOk = codexStatus === 'logged-in';

  // 本地选择，默认 Claude（如果两个都登录），单 CLI 登录时锁定为它
  const [pick, setPick] = useState<'claude' | 'codex' | null>(
    selectedCli ?? (claudeOk ? 'claude' : codexOk ? 'codex' : null),
  );

  // status 变化时把默认值刷一下，但不要覆盖用户已经做出的选择
  useEffect(() => {
    if (pick) return;
    if (claudeOk) setPick('claude');
    else if (codexOk) setPick('codex');
  }, [claudeOk, codexOk, pick]);

  const canContinue = pick !== null && (pick === 'claude' ? claudeOk : codexOk);

  async function reprobe() {
    setProbing(true);
    try {
      await ui.probeCli();
    } catch (err) {
      console.error('probe failed', err);
    } finally {
      setProbing(false);
    }
  }

  function copy(cmd: string) {
    navigator.clipboard.writeText(cmd).catch(() => {});
  }

  async function handleContinue() {
    if (!pick || !canContinue) return;
    await ui.setCli(pick);
    onContinue();
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        background: '#FBFBFC',
        boxSizing: 'border-box',
        overflow: 'auto',
      }}
    >
      <div style={{ width: 560 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div
            style={{
              width: 52,
              height: 52,
              margin: '0 auto 14px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #1373D9 0%, #4A9FE5 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFF',
              boxShadow: '0 6px 20px rgba(19,115,217,0.25)',
            }}
          >
            <SparkleIcon size={24} color="#FFF" />
          </div>
          <h1 style={{ fontSize: 20, margin: '0 0 6px', fontWeight: 600 }}>
            {claudeOk || codexOk ? '选择要使用的 AI 工具' : '需要先登录一个本地 AI 工具'}
          </h1>
          <p
            style={{
              fontSize: 13,
              color: tbStyles.textMuted,
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            AI 邮件助手依赖你本地的命令行工具运行模型。
            <br />
            {claudeOk || codexOk
              ? '点击卡片选中，然后"继续"。'
              : '请在终端中登录任意一个工具后再回来。'}
          </p>
        </div>

        <CLICard
          logo={<ClaudeLogo size={32} />}
          title="Claude Code"
          status={claudeStatus}
          version={status?.claude.version}
          commands={['claude login']}
          onCopy={copy}
          selectable={claudeOk}
          selected={pick === 'claude' && claudeOk}
          onSelect={() => setPick('claude')}
        />

        <CLICard
          logo={<CodexLogo size={32} />}
          title="Codex CLI"
          status={codexStatus}
          version={status?.codex.version}
          commands={['npm install -g @openai/codex', 'codex login']}
          onCopy={copy}
          selectable={codexOk}
          selected={pick === 'codex' && codexOk}
          onSelect={() => setPick('codex')}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 11.5, color: tbStyles.textFaint }}>
            登录态变化后请点"重新检测"
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={reprobe}
              disabled={probing}
              style={{
                padding: '7px 14px',
                fontSize: 12.5,
                background: '#FFF',
                color: tbStyles.text,
                border: `1px solid ${tbStyles.border}`,
                borderRadius: 5,
                cursor: probing ? 'wait' : 'pointer',
                font: 'inherit',
              }}
            >
              {probing ? '检测中…' : '重新检测'}
            </button>
            <button
              onClick={handleContinue}
              disabled={!canContinue}
              style={{
                padding: '7px 16px',
                fontSize: 12.5,
                fontWeight: 500,
                background: canContinue ? tbStyles.blue : '#B5B5B5',
                color: '#FFF',
                border: 'none',
                borderRadius: 5,
                cursor: canContinue ? 'pointer' : 'not-allowed',
                font: 'inherit',
              }}
            >
              继续 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
