#!/usr/bin/env node
// ThunderClaw Native Messaging Host
// 与扩展通过 stdio + 4-byte length-prefix 协议通信。

import { readMessages, writeMessage } from './protocol.mjs';
import { probeAll, callLLM } from './cli.mjs';
import { VERSION, PROTOCOL_VERSION } from './version.mjs';

function log(...args) {
  process.stderr.write(`[thunderclaw-host] ${args.join(' ')}\n`);
}

let inflight = 0;
let stdinEnded = false;

function maybeExit() {
  if (stdinEnded && inflight === 0) {
    // 等所有 stdout 落盘
    process.stdout.end(() => process.exit(0));
  }
}

async function handle(req) {
  const { id, method, params } = req;
  inflight++;
  try {
    let result;
    switch (method) {
      case 'ping':
        result = { ok: true, pid: process.pid };
        break;
      case 'host-info':
        // 扩展用这条做版本握手：拿不到 / 拿到 mismatch → 提示用户重装 native host
        result = { version: VERSION, protocolVersion: PROTOCOL_VERSION };
        break;
      case 'probe-cli':
        result = await probeAll();
        break;
      case 'llm-call':
        // 根据 engine 字段（'claude' | 'codex'）路由到对应 CLI
        result = {
          text: await callLLM({
            engine: params.engine,
            prompt: params.prompt,
            systemPrompt: params.systemPrompt,
            timeoutMs: params.timeoutMs,
          }),
        };
        break;
      default:
        throw new Error(`unknown method: ${method}`);
    }
    writeMessage(process.stdout, { id, result });
  } catch (err) {
    log('error in', method, ':', err.message);
    writeMessage(process.stdout, {
      id,
      error: { message: String(err && err.message ? err.message : err) },
    });
  } finally {
    inflight--;
    maybeExit();
  }
}

readMessages(process.stdin, (msg) => {
  handle(msg).catch((err) => log('handle threw:', err));
});

process.stdin.on('end', () => {
  stdinEnded = true;
  maybeExit();
});
log('started, pid', process.pid);
