// 与 Native Messaging Host 通信的 RPC 客户端。
// 用 long-lived port (connectNative)，多请求复用同一进程。

import type {
  NativeRequest,
  NativeResponse,
  ProbeResult,
  ClaudeCallParams,
  ClaudeCallResult,
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

  // 根据用户在 UI 里选的 CLI 引擎路由到对应后端。
  // selectedCli 为 null（用户没选过）时兜底走 claude。
  async callLLM(params: ClaudeCallParams) {
    const state = await getState();
    const engine = state.selectedCli ?? 'claude';
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
