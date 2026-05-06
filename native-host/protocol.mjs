// Native Messaging 协议: 4-byte little-endian length prefix + JSON payload.

import { Buffer } from 'node:buffer';

export function readMessages(stream, onMessage) {
  let buffer = Buffer.alloc(0);
  stream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const len = buffer.readUInt32LE(0);
      if (buffer.length < 4 + len) break;
      const payload = buffer.subarray(4, 4 + len).toString('utf8');
      buffer = buffer.subarray(4 + len);
      try {
        onMessage(JSON.parse(payload));
      } catch (err) {
        process.stderr.write(`[thunderclaw-host] parse error: ${err}\n`);
      }
    }
  });
}

export function writeMessage(stream, obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  stream.write(Buffer.concat([header, payload]));
}
