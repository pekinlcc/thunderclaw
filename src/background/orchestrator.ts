// 把整条流水线串起来：Roost → Pulse（流式）→ Briefing 合并。
// v1 首次扫描硬上限 50 个最高分联系人，剩下的需要 ui:scan-more 触发。

import { runRoost, type ContactBundle } from './roost';
import { runPulse, runBriefing } from './pulse';
import { getState, setBriefing, setPipeline, setState } from './store';

const FIRST_RUN_CAP = 50;

let running = false;
let stopFlag = false;

// 暂存上一次 Roost 的全部 bundles，scanMore 时从这里继续
let lastBundles: ContactBundle[] = [];
let lastIntro = '';
let lastScannedKeys: Set<string> = new Set();

export async function startPipeline() {
  if (running) {
    console.warn('[ThunderClaw] pipeline already running');
    return;
  }
  running = true;
  stopFlag = false;
  try {
    const state = await getState();
    // 重新跑 Roost（headers-only，秒级完成）
    const bundles = await runRoost((m) => console.log('[roost]', m));
    lastBundles = bundles;
    lastIntro = state.intro;
    lastScannedKeys = new Set();

    const acked = new Set(state.acknowledged);
    const muted = new Set(state.muted);

    // 首次取 top FIRST_RUN_CAP，剩下的留给 scanMore
    const firstSlice = bundles.slice(0, FIRST_RUN_CAP);
    const remaining = bundles.length - firstSlice.length;
    await setState({
      // 重新跑时清掉之前的简报
      briefing: [],
      briefingFinishedAt: null,
      unscannedContacts: remaining,
    });

    const items = await runPulse(firstSlice, state.intro, acked, muted, () => stopFlag);
    for (const b of firstSlice) lastScannedKeys.add(b.key);

    if (stopFlag) {
      await setPipeline({ phase: 'idle' });
      return;
    }

    // 所有 Pulse 跑完，最后一次 Briefing 合并
    await setPipeline({ phase: 'briefing' });
    const merged = await runBriefing(items);
    await setBriefing(merged);
    await setPipeline({ phase: 'done', finishedAt: Date.now() });
  } catch (err) {
    console.error('[ThunderClaw] pipeline error:', err);
    await setPipeline({
      phase: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running = false;
  }
}

// 用户点 "扫描更多" 时调用，继续处理剩余的联系人。
export async function scanMore() {
  if (running) return;
  if (lastBundles.length === 0) return;
  const remainingBundles = lastBundles.filter((b) => !lastScannedKeys.has(b.key));
  if (remainingBundles.length === 0) return;
  running = true;
  stopFlag = false;
  try {
    const state = await getState();
    const acked = new Set(state.acknowledged);
    const muted = new Set(state.muted);
    const slice = remainingBundles.slice(0, FIRST_RUN_CAP);
    const items = await runPulse(slice, lastIntro, acked, muted, () => stopFlag);
    for (const b of slice) lastScannedKeys.add(b.key);
    const left = remainingBundles.length - slice.length;
    await setState({ unscannedContacts: left });

    if (stopFlag) {
      await setPipeline({ phase: 'idle' });
      return;
    }

    // 把这批新的 + 之前已经在 briefing 里的合并一次
    await setPipeline({ phase: 'briefing' });
    const cur = await getState();
    const allItems = [...cur.briefing, ...items.filter((it) => !cur.briefing.find((c) => c.id === it.id))];
    const merged = await runBriefing(allItems);
    await setBriefing(merged);
    await setPipeline({ phase: 'done', finishedAt: Date.now() });
  } catch (err) {
    console.error('[ThunderClaw] scan-more error:', err);
    await setPipeline({
      phase: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running = false;
  }
}

export function isRunning() {
  return running;
}

export function requestStop() {
  stopFlag = true;
}
