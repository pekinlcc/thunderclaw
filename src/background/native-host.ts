// 与 Native Messaging Host 通信的 RPC 客户端。
// 用 long-lived port (connectNative)，多请求复用同一进程。

import type {
  NativeRequest,
  NativeResponse,
  ProbeResult,
  ClaudeCallParams,
  ClaudeCallResult,
  HostInfo,
  OpenCalendarICSResult,
  DirectCalendarParams,
  DirectCalendarResult,
} from '../shared/protocol';
import { getState } from './store';

const HOST_NAME = 'thunderclaw';

type Pending = {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
};

class NativeHost {
  private port: browser.runtime.Port | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 0;

  private connect() {
    if (this.port) return this.port;
    console.log('[ThunderClaw][NMH] connectNative:', HOST_NAME);
    const port = browser.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener((raw) => {
      const msg = raw as NativeResponse;
      console.log('[ThunderClaw][NMH] recv:', JSON.stringify(msg).slice(0, 200));
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if ('error' in msg) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
    port.onDisconnect.addListener(() => {
      const err = browser.runtime.lastError;
      const message = err?.message ?? 'native host disconnected';
      console.error('[ThunderClaw][NMH] onDisconnect:', message);
      for (const p of this.pending.values()) p.reject(new Error(message));
      this.pending.clear();
      this.port = null;
    });
    this.port = port;
    return port;
  }

  call<T>(req: Omit<NativeRequest, 'id'>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = String(++this.nextId);
      this.pending.set(id, { resolve: resolve as (val: unknown) => void, reject });
      try {
        const port = this.connect();
        port.postMessage({ id, ...req });
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  ping() {
    return this.call<{ ok: boolean; pid: number }>({
      method: 'ping',
      params: {},
    });
  }

  probeCli() {
    return this.call<ProbeResult>({ method: 'probe-cli', params: {} });
  }

  // 版本握手。老 host（pre-v0.1.18）会回 "unknown method: host-info"——
  // 调用方据此判断是否过旧并提示用户重装。
  getHostInfo() {
    return this.call<HostInfo>({ method: 'host-info', params: {} });
  }

  // 让 native host 把 .ics 喂给 Thunderbird —— 用户点一下 TB 弹的"导入"对话框就行，
  // 不会被系统默认 .ics handler（Mac 上是 Apple Calendar）拦截。
  openCalendarICS(ics: string) {
    return this.call<OpenCalendarICSResult>({ method: 'open-calendar-ics', params: { ics } });
  }

  // 直写 TB 本地日历 SQLite —— 完全跳过导入对话框。
  // 老 host（pre-v0.4.0，PROTOCOL_VERSION<5）不认这个方法，会回 unknown method，
  // 调用方 catch 后回退到 openCalendarICS。
  directCalendarCreate(params: DirectCalendarParams) {
    return this.call<DirectCalendarResult>({
      method: 'direct-calendar-create',
      params,
    });
  }

  // 根据用户在 UI 里选的 CLI 引擎路由到对应后端。
  // 整个 pipeline 都被 introCompleted 门挡着，到这里 selectedCli 不该是 null；
  // 真到了就抛——比悄悄回退到 claude 安全（用户选了 Codex 却走了 Claude 是隐蔽 bug）。
  async callLLM(params: ClaudeCallParams) {
    const state = await getState();
    const engine = state.selectedCli;
    if (engine !== 'claude' && engine !== 'codex') {
      throw new Error('No CLI engine selected — finish the intro first');
    }
    // 日志带上 engine 名，便于用户复现"我选了 Codex，看简报为啥还是空"的时候核对
    console.log('[ThunderClaw][NMH] llm-call engine=', engine, 'promptLen=', params.prompt.length);
    return this.call<ClaudeCallResult>({
      method: 'llm-call',
      params: { ...params, engine },
    });
  }

  shutdown() {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
  }
}

export const nativeHost = new NativeHost();
