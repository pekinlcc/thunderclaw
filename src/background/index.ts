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
import { getEmailPreview, markReadAndArchive, openOriginal } from './messages';
import { generateReply } from './writer';
import { extractEvent, extractTask } from './event-extractor';
import { createCalendarEvent, createTask } from './calendar';
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
  console.log('[ThunderClaw] probe-cli starting');
  try {
    const result = await nativeHost.probeCli();
    console.log('[ThunderClaw] probe-cli result:', JSON.stringify(result));
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
    case 'ui:acknowledge': {
      // 用户点 "我已知晓"：标记 item 已处理 + 把对应原邮件标已读 + 归档
      const cur = await getState();
      const item = cur.briefing.find((i) => i.id === req.itemId);
      const ids = item?.emailIds ?? [];
      let archiveResult: Awaited<ReturnType<typeof markReadAndArchive>> | null = null;
      if (ids.length > 0) {
        archiveResult = await markReadAndArchive(ids);
        if (archiveResult.errors.length) {
          console.warn('[ThunderClaw] ack archive errors:', archiveResult.errors);
        }
      }
      await acknowledge(req.itemId);
      return { ok: true, archive: archiveResult };
    }
    case 'ui:mute-thread':
      await muteThread(req.itemId);
      return { ok: true };
    case 'ui:get-email-preview': {
      try {
        const preview = await getEmailPreview(req.messageId);
        if (!preview) return { ok: false, error: 'preview unavailable' };
        return { ok: true, preview };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case 'ui:open-original': {
      try {
        await openOriginal(req.messageId);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case 'ui:create-calendar-event': {
      const state = await getState();
      const item = state.briefing.find((i) => i.id === req.itemId);
      if (!item) return { ok: false, error: 'item not found' };
      try {
        const event = await extractEvent({ item, actionLabel: req.actionLabel });
        if (!event) return { ok: false, error: '无法解析出事件信息' };
        const result = await createCalendarEvent(event);
        return { ok: result.ok, result, event };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case 'ui:create-task': {
      const state = await getState();
      const item = state.briefing.find((i) => i.id === req.itemId);
      if (!item) return { ok: false, error: 'item not found' };
      try {
        const task = await extractTask({ item, actionLabel: req.actionLabel });
        if (!task) return { ok: false, error: '无法解析出任务信息' };
        const result = await createTask(task);
        return { ok: result.ok, result, task };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case 'ui:generate-reply': {
      const state = await getState();
      const item = state.briefing.find((i) => i.id === req.itemId);
      if (!item) return { ok: false, error: 'item not found' };
      try {
        const text = await generateReply({ item, actionLabel: req.actionLabel });
        return { ok: true, text };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case 'ui:open-compose': {
      const state = await getState();
      const item = state.briefing.find((i) => i.id === req.itemId);
      if (!item) return { ok: false, error: 'item not found' };
      try {
        await openComposeFor({
          item,
          replyText: req.replyText,
          replyAll: req.replyAll,
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
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
