// Native host 版本握手提示条。
// 当 background 启动时调 host-info 失败 / 版本不对，UI 顶端会盖一条带"如何重装"的红/黄条。
//
// 这条横幅是用来堵 v0.1.18 之前的"XPI 升了 host 没升 → llm-call 全报 unknown method
// → 用户看到'今日无重要事项'但毫无提示"那个坑的——任何在 background 跑起来后协议
// 不通的状态都要通过这里**显式**告诉用户该干嘛。

import { useState } from 'react';
import type { HostHandshake } from '../shared/protocol';
import { tbStyles } from './styles';

// 探一下宿主操作系统，给对应的重装命令。
// browser.runtime.getPlatformInfo 是异步的，组件初次渲染时还没结果——
// 先按 navigator.platform 字符串猜，async 拿到 PlatformInfo 后纠正。
function detectOS(): 'mac' | 'linux' | 'win' | 'unknown' {
  const p = (typeof navigator !== 'undefined' && navigator.platform) || '';
  if (/mac|iphone|ipad/i.test(p)) return 'mac';
  if (/win/i.test(p)) return 'win';
  if (/linux/i.test(p)) return 'linux';
  return 'unknown';
}

function reinstallSnippet(version: string, os: 'mac' | 'linux' | 'win' | 'unknown'): string {
  // Linux 推荐 .deb，覆盖最多 TB 发行版且自带 policies.json 自动启用扩展
  if (os === 'linux') {
    return [
      '# 用 .deb 一键装（XPI + native host 同步更新）',
      `curl -fsSLO https://github.com/pekinlcc/thunderclaw/releases/download/v${version}/thunderclaw_${version}_all.deb`,
      `sudo apt install ./thunderclaw_${version}_all.deb`,
    ].join('\n');
  }
  // Mac / Windows / unknown：拉 native-host tarball 一键装
  if (os === 'win') {
    return [
      '# PowerShell：',
      `Invoke-WebRequest -OutFile thunderclaw-host.zip https://github.com/pekinlcc/thunderclaw/releases/download/v${version}/thunderclaw-native-host-v${version}.zip`,
      'Expand-Archive thunderclaw-host.zip -DestinationPath .',
      `cd thunderclaw-native-host-v${version}`,
      'node scripts\\install-native-host.mjs',
    ].join('\n');
  }
  // Mac / unknown：一键脚本（拉 host + 落 XPI 进 profile + 关签名校验 + 自动重启 TB）
  if (os === 'mac') {
    return `curl -fsSL https://raw.githubusercontent.com/pekinlcc/thunderclaw/main/scripts/install-mac.sh | bash -s -- ${version}`;
  }
  // 其他平台兜底（手动 tarball）
  return [
    `curl -fsSL https://github.com/pekinlcc/thunderclaw/releases/download/v${version}/thunderclaw-native-host-v${version}.tar.gz | tar -xz`,
    `cd thunderclaw-native-host-v${version}`,
    'node scripts/install-native-host.mjs',
    '# 然后完全退出 Thunderbird 再重开',
  ].join('\n');
}

function getDisplayedVersion(): string {
  // 从 manifest.json 读，避免硬编码
  try {
    const m = (browser.runtime.getManifest() as { version?: string }).version;
    if (m) return m;
  } catch {
    /* ignore */
  }
  return '';
}

export function HostHandshakeBanner({ handshake }: { handshake: HostHandshake }) {
  const [showCmd, setShowCmd] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!handshake) return null;
  if (handshake.kind === 'matched') return null;

  const isError = handshake.kind === 'too-old';
  const version = getDisplayedVersion();
  const os = detectOS();
  const cmd = reinstallSnippet(version, os);

  const palette = isError
    ? { bg: '#FEF1ED', border: '#F0BAA9', fg: '#8C2A14', icon: '⚠' }
    : { bg: '#FEF8E7', border: '#EBD49A', fg: '#7A5814', icon: 'ⓘ' };

  const headline = isError
    ? 'Native host 版本过旧，扩展无法工作'
    : 'Native host 与扩展版本不一致';

  const detail =
    handshake.kind === 'too-old'
      ? `请按下方命令重装 native host（${handshake.reason}）`
      : `host v${handshake.hostVersion}，扩展期望 v${handshake.expectedVersion}。建议同步更新。`;

  async function copyCmd() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('clipboard write failed:', err);
    }
  }

  return (
    <div
      style={{
        background: palette.bg,
        borderBottom: `1px solid ${palette.border}`,
        color: palette.fg,
        padding: '8px 14px',
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14 }}>{palette.icon}</span>
        <span style={{ flex: 1 }}>
          <strong>{headline}</strong>
          <span style={{ marginLeft: 8, color: palette.fg, opacity: 0.85 }}>{detail}</span>
        </span>
        <button
          onClick={() => setShowCmd((v) => !v)}
          style={{
            padding: '3px 10px',
            fontSize: 11,
            background: '#FFF',
            color: palette.fg,
            border: `1px solid ${palette.border}`,
            borderRadius: 3,
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          {showCmd ? '收起' : '查看重装命令'}
        </button>
      </div>
      {showCmd && (
        <div style={{ marginTop: 8, paddingLeft: 24 }}>
          <pre
            style={{
              margin: 0,
              padding: '8px 10px',
              background: '#FFF',
              border: `1px solid ${palette.border}`,
              borderRadius: 3,
              fontSize: 11.5,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: tbStyles.text,
            }}
          >
            {cmd}
          </pre>
          <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={copyCmd}
              style={{
                padding: '3px 10px',
                fontSize: 11,
                background: '#FFF',
                color: palette.fg,
                border: `1px solid ${palette.border}`,
                borderRadius: 3,
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              {copied ? '已复制' : '复制命令'}
            </button>
            <span style={{ fontSize: 11, color: tbStyles.textMuted }}>
              {os === 'mac'
                ? '装完务必 Cmd+Q 完全退出 Thunderbird 再打开'
                : os === 'win'
                  ? '装完关掉 Thunderbird 再打开'
                  : '装完关掉 Thunderbird 再打开'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
