#!/usr/bin/env node
// ThunderClaw Native Messaging Host
// 与扩展通过 stdio + 4-byte length-prefix 协议通信。

import { readMessages, writeMessage } from './protocol.mjs';
import { probeAll, callClaude } from './cli.mjs';

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
      case 'probe-cli':
        result = await probeAll();
        break;
      case 'claude-call':
        result = {
          text: await callClaude({
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
