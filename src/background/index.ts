// 后台主入口：注册 spaces、监听 UI 消息、串起整条流水线。

import { nativeHost } from './native-host';
import { startPipeline, scanMore } from './orchestrator';
import {
  acknowledge,
  getState,
  muteThread,
  setAutoRecompute,
  setCliStatus,
  setSelectedCli,
  setState,
} from './store';
import { EXPECTED_PROTOCOL_VERSION, type HostHandshake } from '../shared/protocol';
import { openComposeFor } from './compose';
import { getEmailPreview, markReadAndArchive, openOriginal } from './messages';
import { generateReply } from './writer';
import { extractEvent, extractTask } from './event-extractor';
import { createCalendarEvent, createTask } from './calendar';
import { enqueueNewMailSender } from './auto-recompute';
import { parseAddress } from './roost';
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

// 版本握手：早期 host（pre-v0.1.18）不认 host-info，会回 "unknown method..."；
// 新 host 回 { version, protocolVersion }。把结果归一成 HostHandshake 写进 state，
// UI 据此画顶端的红/黄条。
const EXTENSION_VERSION = (browser.runtime.getManifest() as { version: string }).version;

async function handshakeAndStore(): Promise<HostHandshake> {
  let handshake: HostHandshake;
  try {
    const info = await nativeHost.getHostInfo();
    if (info.protocolVersion < EXPECTED_PROTOCOL_VERSION) {
      handshake = {
        kind: 'too-old',
        reason: `host protocol v${info.protocolVersion} < required v${EXPECTED_PROTOCOL_VERSION}`,
      };
    } else if (info.version !== EXTENSION_VERSION) {
      handshake = {
        kind: 'mismatch',
        hostVersion: info.version,
        expectedVersion: EXTENSION_VERSION,
      };
    } else {
      handshake = { kind: 'matched', version: info.version, protocolVersion: info.protocolVersion };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "unknown method: host-info" → 老 host
    if (/unknown method/i.test(msg)) {
      handshake = { kind: 'too-old', reason: 'host does not support host-info' };
    } else {
      // 连接彻底没起来——也当 too-old 处理（用户最有用的反馈是"重装"）
      handshake = { kind: 'too-old', reason: msg };
    }
  }
  console.log('[ThunderClaw] host handshake:', JSON.stringify(handshake));
  await setState({ hostHandshake: handshake });
  return handshake;
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
    case 'ui:set-auto-recompute':
      await setAutoRecompute(req.enabled);
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
      // 用户点 "我已知晓"：标记 item 已处理 + 把对应原邮件标已读 + 归档。
      // 只动 incomingEmailIds（"收到"那部分），不要把用户自己 Sent 里的邮件搬走。
      const cur = await getState();
      const item = cur.briefing.find((i) => i.id === req.itemId);
      const ids = item?.incomingEmailIds ?? [];
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
    case 'ui:extract-calendar-event': {
      const state = await getState();
      const item = state.briefing.find((i) => i.id === req.itemId);
      if (!item) return { ok: false, error: 'item not found' };
      try {
        const event = await extractEvent({ item, actionLabel: req.actionLabel });
        if (!event) return { ok: false, error: '无法解析出事件信息' };
        return { ok: true, event };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case 'ui:commit-calendar-event': {
      try {
        const result = await createCalendarEvent(req.event);
        return { ok: result.ok, result };
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
    case 'ui:extract-task': {
      const state = await getState();
      const item = state.briefing.find((i) => i.id === req.itemId);
      if (!item) return { ok: false, error: 'item not found' };
      try {
        const task = await extractTask({ item, actionLabel: req.actionLabel });
        if (!task) return { ok: false, error: '无法解析出任务信息' };
        return { ok: true, task };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case 'ui:commit-task': {
      try {
        const result = await createTask(req.task);
        return { ok: result.ok, result };
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

console.log('[ThunderClaw] background script started, ext version', EXTENSION_VERSION);
ensureSpace().catch((err) => console.error('[ThunderClaw] space register failed:', err));
// 启动时跑一次握手；UI 顶端的"请重装 native host"红条由此触发
handshakeAndStore().catch((err) => console.error('[ThunderClaw] handshake failed:', err));

// 新邮件触发的增量重算。把每封新邮件的发件人塞进 auto-recompute 的 debounce 队列；
// 30 秒内没新邮件就跑一次"针对受影响联系人的"重 Pulse + 重 Briefing。
// 用户在简报顶端可以通过 toggle 关掉。
try {
  browser.messages.onNewMailReceived.addListener((_folder, msgs) => {
    if (!msgs || !msgs.messages) return;
    for (const m of msgs.messages) {
      // header.author 可能是 'Name <a@b>'——抽出 email 部分
      const parsed = parseAddress(m.author);
      const email = parsed[0]?.email;
      if (email) enqueueNewMailSender(email);
    }
    console.log('[ThunderClaw] onNewMailReceived: queued', msgs.messages.length, 'sender(s)');
  });
} catch (err) {
  console.warn('[ThunderClaw] onNewMailReceived registration failed:', err);
}
