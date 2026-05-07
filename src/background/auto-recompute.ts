// 新邮件触发的增量重算。
//
// 机制：
//   1. background/index.ts 注册 messages.onNewMailReceived，每封新邮件
//      抽出发件人 email 塞进 pendingSenders 集合，并触发 / 重置 30 秒 debounce 定时器
//   2. debounce 到期：
//      - 看用户的 autoRecompute 是否打开
//      - 看 orchestrator 有没有 pipeline 在跑（在跑的话再延 30 秒）
//      - 重新跑一次 Roost（headers only，便宜），过滤出受影响联系人
//      - 只对这些联系人重跑 Pulse，结果合并掉旧卡片
//      - 全量重跑 Briefing 拿到新的整体 overview + 顺序
//
// 显式不做：
//   - 删除/移动邮件不触发（messages.onMoved 单独想做的话再加）
//   - 用户正在某张卡上交互时不延迟（v0.2.0 接受偶尔被替换；后续可加 active-card 锁）

import { runRoost } from './roost';
import { runPulse, runBriefing } from './pulse';
import { isRunning } from './orchestrator';
import { getState, setBriefing, setPipeline } from './store';
import { lowerEmail } from './roost';

const DEBOUNCE_MS = 30_000;

let pendingSenders: Set<string> = new Set();
let timer: ReturnType<typeof setTimeout> | null = null;
let recomputing = false;

export function enqueueNewMailSender(email: string) {
  const e = lowerEmail(email);
  if (!e) return;
  pendingSenders.add(e);
  scheduleFlush();
}

function scheduleFlush() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    flush().catch((err) => console.error('[ThunderClaw][recompute] flush threw:', err));
  }, DEBOUNCE_MS);
}

async function flush() {
  timer = null;

  const state = await getState();
  if (!state.autoRecompute) {
    console.log('[ThunderClaw][recompute] auto-recompute is off, dropping queue');
    pendingSenders = new Set();
    return;
  }
  // 没完成 onboarding 的时候不要起；用户还没选 CLI 引擎
  if (!state.introCompleted || !state.selectedCli) {
    pendingSenders = new Set();
    return;
  }

  // 撞到正在跑的全量 pipeline → 再延 30s
  if (recomputing || isRunning()) {
    console.log('[ThunderClaw][recompute] pipeline busy, retry in', DEBOUNCE_MS / 1000, 's');
    scheduleFlush();
    return;
  }

  if (pendingSenders.size === 0) return;
  const senders = pendingSenders;
  pendingSenders = new Set();

  recomputing = true;
  try {
    await doRecompute(senders);
  } catch (err) {
    console.error('[ThunderClaw][recompute] doRecompute failed:', err);
    // pipeline 可能停在中间状态——回到 done，避免 UI 一直转
    await setPipeline({ phase: 'done', finishedAt: Date.now() });
  } finally {
    recomputing = false;
  }
}

async function doRecompute(senders: Set<string>) {
  console.log('[ThunderClaw][recompute] firing for senders:', [...senders]);

  // 1) Roost 一次（headers only，秒级）——拿到包含新邮件的 fresh bundle
  const bundles = await runRoost((m) => console.log('[recompute][roost]', m));
  const affected = bundles.filter((b) =>
    b.emails.some((e) => senders.has(lowerEmail(e))),
  );
  if (affected.length === 0) {
    console.log('[ThunderClaw][recompute] no affected bundles within scan window — done');
    return;
  }
  console.log('[ThunderClaw][recompute] affected bundles:', affected.map((b) => b.primaryEmail));

  const state = await getState();
  const acked = new Set(state.acknowledged);
  const muted = new Set(state.muted);

  // 2) 只 Pulse 受影响的联系人
  await setPipeline({
    phase: 'pulse',
    total: affected.length,
    processed: 0,
    current: '新邮件触发的增量分析',
  });
  const newItems = await runPulse(affected, state.intro, acked, muted);

  // 3) 合并：briefing item id 形如 "contactKey::threadKey"——把同 contactKey
  //    的老卡片剔掉，再追加新出的 + 完全没变的留着
  const affectedKeys = new Set(affected.map((b) => b.key));
  const cur = await getState();
  const survived = cur.briefing.filter((it) => {
    const colonIdx = it.id.indexOf('::');
    const contactKey = colonIdx >= 0 ? it.id.slice(0, colonIdx) : it.id;
    return !affectedKeys.has(contactKey);
  });
  const merged = [...survived, ...newItems];

  // 4) 全量 Briefing 重排序 + 重写整体 overview
  await setPipeline({ phase: 'briefing' });
  const result = await runBriefing(merged);
  await setBriefing(result.items, result.overview);
  await setPipeline({ phase: 'done', finishedAt: Date.now() });

  console.log(
    '[ThunderClaw][recompute] done — survived',
    survived.length,
    '+ new',
    newItems.length,
    '→ briefing',
    result.items.length,
  );
}
