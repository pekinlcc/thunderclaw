import type { AppState, ProbeResult, UIRequest } from '../shared/protocol';

async function send<T>(msg: UIRequest): Promise<T> {
  return (await browser.runtime.sendMessage(msg)) as T;
}

export const ui = {
  probeCli: () =>
    send<{ ok: boolean; result?: ProbeResult; error?: string }>({ kind: 'ui:probe-cli' }),
  getState: () => send<AppState>({ kind: 'ui:get-state' }),
  setCli: (cli: 'claude' | 'codex') => send({ kind: 'ui:set-cli', cli }),
  saveIntro: (intro: string) => send({ kind: 'ui:save-intro', intro }),
  startPipeline: () => send({ kind: 'ui:start-pipeline' }),
  scanMore: () => send({ kind: 'ui:scan-more' }),
  acknowledge: (itemId: string) => send({ kind: 'ui:acknowledge', itemId }),
  muteThread: (itemId: string) => send({ kind: 'ui:mute-thread', itemId }),
  openCompose: (itemId: string, replyAll = false) =>
    send({ kind: 'ui:open-compose', itemId, replyAll }),
  copyReply: (itemId: string) =>
    send<{ ok: boolean; text?: string; error?: string }>({ kind: 'ui:copy-reply', itemId }),
};

export function onBgStateChange(fn: () => void) {
  const handler = (msg: { kind?: string }) => {
    if (msg && msg.kind === 'bg:state-changed') fn();
  };
  browser.runtime.onMessage.addListener(handler);
  return () => browser.runtime.onMessage.removeListener(handler);
}
