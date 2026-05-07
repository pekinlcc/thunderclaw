// browser.storage.local 封装。

import type { AppState, Pipeline, BriefingItem, ProbeResult } from '../shared/protocol';

const KEY = 'thunderclaw.state';
// 任何会改变 BriefingItem / SuggestedAction 形状的版本，bump 这个数字。
// store 加载时如果发现存的不是当前 schema，会清掉 briefing / acknowledged /
// muted 这些运行时缓存（避免新代码读到老结构数据崩 UI），但保留 intro / selectedCli。
const SCHEMA_VERSION = 3;

function defaultState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    cliStatus: null,
    selectedCli: null,
    intro: '',
    introCompleted: false,
    pipeline: { phase: 'idle' },
    briefing: [],
    briefingFinishedAt: null,
    acknowledged: [],
    muted: [],
    unscannedContacts: 0,
    hostHandshake: null,
  };
}

let cached: AppState | null = null;
const listeners = new Set<(s: AppState) => void>();

export async function getState(): Promise<AppState> {
  if (cached) return cached;
  const raw = await browser.storage.local.get(KEY);
  const stored = (raw as Record<string, unknown>)[KEY] as Partial<AppState> | undefined;

  if (!stored || stored.schemaVersion !== SCHEMA_VERSION) {
    // schema 升级：丢掉运行时缓存，保留用户配置
    const migrated: AppState = {
      ...defaultState(),
      intro: typeof stored?.intro === 'string' ? stored.intro : '',
      introCompleted: stored?.introCompleted ?? false,
      selectedCli:
        stored?.selectedCli === 'claude' || stored?.selectedCli === 'codex'
          ? stored.selectedCli
          : null,
    };
    cached = migrated;
    await browser.storage.local.set({ [KEY]: migrated });
    if (stored) {
      console.log(
        `[ThunderClaw] storage schema migrated ${stored.schemaVersion ?? '<none>'} → ${SCHEMA_VERSION}, briefing cache cleared`,
      );
    }
    return migrated;
  }

  // schema 一致直接合并
  cached = { ...defaultState(), ...stored };
  return cached;
}

export async function setState(patch: Partial<AppState>) {
  const current = await getState();
  cached = { ...current, ...patch };
  await browser.storage.local.set({ [KEY]: cached });
  for (const fn of listeners) fn(cached);
}

export async function updateState(fn: (s: AppState) => Partial<AppState>) {
  const current = await getState();
  return setState(fn(current));
}

export function onStateChange(fn: (s: AppState) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function setPipeline(p: Pipeline) {
  return setState({ pipeline: p });
}

export async function setCliStatus(s: ProbeResult) {
  return setState({ cliStatus: s });
}

export async function setSelectedCli(cli: 'claude' | 'codex') {
  return setState({ selectedCli: cli });
}

export async function setBriefing(items: BriefingItem[]) {
  return setState({ briefing: items, briefingFinishedAt: Date.now() });
}

// 流式：把单个 Pulse 的结果合并进 briefing 数组，按 priority 排序。
// 同一 itemId 已存在则替换。
export async function appendBriefingItems(newItems: BriefingItem[]) {
  if (newItems.length === 0) return;
  const s = await getState();
  const map = new Map(s.briefing.map((i) => [i.id, i]));
  for (const it of newItems) map.set(it.id, it);
  const merged = [...map.values()].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  return setState({ briefing: merged });
}

function priorityRank(p: 'high' | 'medium' | 'low'): number {
  return p === 'high' ? 0 : p === 'medium' ? 1 : 2;
}

export async function acknowledge(itemId: string) {
  const s = await getState();
  if (s.acknowledged.includes(itemId)) return;
  return setState({ acknowledged: [...s.acknowledged, itemId] });
}

export async function muteThread(itemId: string) {
  const s = await getState();
  if (s.muted.includes(itemId)) return;
  return setState({ muted: [...s.muted, itemId] });
}
