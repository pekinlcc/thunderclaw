import { useEffect, useState } from 'react';
import { ui, onBgStateChange } from './messaging';
import type { AppState } from '../shared/protocol';
import { CLIPickerScreen } from './screens/cli-picker';
import { IntroSetupScreen } from './screens/intro-setup';
import { LoadingScreen } from './screens/loading';
import { BriefingScreen } from './screens/briefing';
import { HostHandshakeBanner } from './host-banner';
import { tbStyles } from './styles';

type View = 'cli' | 'intro' | 'loading' | 'briefing';

function pickView(s: AppState): View {
  const claudeOk = s.cliStatus?.claude.loggedIn;
  const codexOk = s.cliStatus?.codex.loggedIn;
  // 没 CLI 登录、或用户还没显式选 → 停在 CLI picker
  if (!claudeOk && !codexOk) return 'cli';
  if (!s.selectedCli) return 'cli';
  if (!s.introCompleted) return 'intro';
  // Roost 阶段（headers 扫描）显示 loading，
  // Pulse / briefing 阶段 briefing 屏会显示流式进度 + 已有卡片
  if (s.pipeline.phase === 'roost') return 'loading';
  return 'briefing';
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  async function refresh() {
    try {
      const s = await ui.getState();
      setState(s);
    } catch (err) {
      setBootError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    refresh();
    const off = onBgStateChange(refresh);
    return off;
  }, []);

  // 启动时主动 probe 一次（如果还没结果）
  useEffect(() => {
    if (state && !state.cliStatus) {
      ui.probeCli().catch((err) => console.warn('initial probe failed:', err));
    }
  }, [state]);

  if (bootError) {
    return (
      <div style={{ padding: 32, fontSize: 13, color: '#C44A2C', whiteSpace: 'pre-wrap' }}>
        启动失败：{bootError}
      </div>
    );
  }

  if (!state) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: tbStyles.textMuted,
          fontSize: 13,
        }}
      >
        加载中…
      </div>
    );
  }

  const view = pickView(state);

  // 顶部 host 版本握手提示——任何 view 都先盖一条（"too-old" 红条，"mismatch" 黄条）。
  // 占用一行高度，下方 view 按需自适应。
  const banner = <HostHandshakeBanner handshake={state.hostHandshake} />;

  function withBanner(children: React.ReactNode) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {banner}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    );
  }

  switch (view) {
    case 'cli':
      return withBanner(
        <CLIPickerScreen
          status={state.cliStatus}
          selectedCli={state.selectedCli}
          onContinue={async () => {
            await refresh();
          }}
        />,
      );
    case 'intro':
      return withBanner(
        <IntroSetupScreen
          initialIntro={state.intro}
          onDone={async () => {
            await ui.startPipeline();
            await refresh();
          }}
        />,
      );
    case 'loading':
      return withBanner(<LoadingScreen pipeline={state.pipeline} />);
    case 'briefing':
      return withBanner(
        <BriefingScreen
          items={state.briefing.filter(
            (it) => !state.acknowledged.includes(it.id) && !state.muted.includes(it.id),
          )}
          finishedAt={state.briefingFinishedAt}
          pipeline={state.pipeline}
          unscannedContacts={state.unscannedContacts}
          onRerun={async () => {
            await ui.startPipeline();
            await refresh();
          }}
          onScanMore={async () => {
            await ui.scanMore();
            await refresh();
          }}
        />,
      );
  }
}
