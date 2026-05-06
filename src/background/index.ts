// 后台主入口：注册 spaces、监听 UI 消息、串起整条流水线。

import { nativeHost } from './native-host';
import { startPipeline, scanMore } from './orchestrator';
import {
  acknowledge,
  getState,
  muteThread,
  setCliStatus,
  setSelectedCli,
  setState,
} from './store';
import { openComposeFor } from './compose';
import type { UIRequest } from '../shared/protocol';

declare const messenger: typeof browser & {
  spaces: {
    create: (
      name: string,
      defaultUrl: string,
      properties?: { title?: string; defaultIcons?: string },
    ) => Promise<{ id: number }>;
    query: (filter?: { name?: string }) => Promise<Array<{ id: number; name: string }>>;
    update: (
      spaceId: number,
      properties: { badgeText?: string; badgeBackgroundColor?: string },
    ) => Promise<void>;
  };
};

const SPACE_NAME = 'thunderclaw';

async function ensureSpace() {
  console.log('[ThunderClaw] ensureSpace start');
  try {
    const existing = await messenger.spaces.query({ name: SPACE_NAME });
    console.log('[ThunderClaw] spaces.query returned', existing.length, 'matching spaces');
    if (existing.length > 0) {
      console.log('[ThunderClaw] space already exists, skipping create');
      return;
    }
    const created = await messenger.spaces.create(SPACE_NAME, 'ai-view.html', {
      title: 'AI 助手',
      defaultIcons: 'icons/icon-32.png',
    });
    console.log('[ThunderClaw] spaces.create OK, id =', created.id);
    // 加 badge 让图标更显眼（用 update 而不是 create 设这些字段）
    try {
      await messenger.spaces.update(created.id, {
        badgeText: 'AI',
        badgeBackgroundColor: '#1373D9',
      });
      console.log('[ThunderClaw] badge applied');
    } catch (err) {
      console.warn('[ThunderClaw] badge apply failed (non-fatal):', err);
    }
  } catch (err) {
    console.error('[ThunderClaw] ensureSpace failed:', err);
    throw err;
  }
}

async function probeAndStore() {
  try {
    const result = await nativeHost.probeCli();
    // 只更新 cliStatus，不动 selectedCli——由用户在 UI 显式选
    await setCliStatus(result);
    return result;
  } catch (err) {
    console.error('[ThunderClaw] probe-cli failed:', err);
    await setCliStatus({
      claude: { installed: false, loggedIn: false },
      codex: { installed: false, loggedIn: false },
    });
    throw err;
  }
}

browser.runtime.onMessage.addListener(async (raw: unknown) => {
  const req = raw as UIRequest;
  switch (req.kind) {
    case 'ui:probe-cli':
      try {
        return { ok: true, result: await probeAndStore() };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    case 'ui:get-state':
      return await getState();
    case 'ui:set-cli':
      await setSelectedCli(req.cli);
      return { ok: true };
    case 'ui:save-intro':
      await setState({ intro: req.intro, introCompleted: true });
      return { ok: true };
    case 'ui:start-pipeline':
      // fire and forget
      startPipeline();
      return { ok: true };
    case 'ui:scan-more':
      scanMore();
      return { ok: true };
    case 'ui:acknowledge':
      await acknowledge(req.itemId);
      return { ok: true };
    case 'ui:mute-thread':
      await muteThread(req.itemId);
      return { ok: true };
    case 'ui:open-compose': {
      const state = await getState();
      const item = state.briefing.find((i) => i.id === req.itemId);
      if (!item) return { ok: false, error: 'item not found' };
      try {
        await openComposeFor(item, req.replyAll);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case 'ui:copy-reply': {
      const state = await getState();
      const item = state.briefing.find((i) => i.id === req.itemId);
      if (!item || !item.suggestedReply) return { ok: false, error: 'no reply' };
      return { ok: true, text: item.suggestedReply };
    }
    default:
      return { ok: false, error: 'unknown ui request' };
  }
});

// storage 变化时广播给 UI（刷新状态）
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes['thunderclaw.state']) return;
  browser.runtime
    .sendMessage({ kind: 'bg:state-changed' })
    .catch(() => {/* no listeners is ok */});
});

console.log('[ThunderClaw] background script started');
ensureSpace().catch((err) => console.error('[ThunderClaw] space register failed:', err));
