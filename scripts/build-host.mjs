#!/usr/bin/env node
// 交叉编译 Native Messaging Host（Go）到 5 个 target，输出到 dist/host-bin/。
//
// 输入：host/*.go + src/manifest.json + src/shared/protocol.ts（拿 PROTOCOL_VERSION）
// 输出：dist/host-bin/<os>-<arch>/thunderclaw-host[.exe]
//
// 通过 -ldflags "-X main.Version=… -X main.ProtocolVersion=…" 把版本号烧进 binary，
// 这样运行时 host-info RPC 返回的版本永远跟扩展端 manifest 对齐——一处 bump，全链路对齐。

import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HOST_DIR = join(ROOT, 'host');
const OUT_DIR = join(ROOT, 'dist', 'host-bin');

const manifest = JSON.parse(readFileSync(join(ROOT, 'src', 'manifest.json'), 'utf8'));
const VERSION = manifest.version;

const protocolTs = readFileSync(join(ROOT, 'src', 'shared', 'protocol.ts'), 'utf8');
const m = protocolTs.match(/EXPECTED_PROTOCOL_VERSION\s*=\s*(\d+)/);
if (!m) throw new Error('protocol.ts: cannot find EXPECTED_PROTOCOL_VERSION');
const PROTOCOL_VERSION = m[1];

const targets = [
  { goos: 'linux',   goarch: 'amd64', dir: 'linux-amd64',  ext: '' },
  { goos: 'linux',   goarch: 'arm64', dir: 'linux-arm64',  ext: '' },
  { goos: 'darwin',  goarch: 'amd64', dir: 'darwin-amd64', ext: '' },
  { goos: 'darwin',  goarch: 'arm64', dir: 'darwin-arm64', ext: '' },
  { goos: 'windows', goarch: 'amd64', dir: 'windows-amd64', ext: '.exe' },
];

if (!existsSync(HOST_DIR)) {
  console.error('✗ host/ directory missing');
  process.exit(1);
}

console.log(`Building thunderclaw-host v${VERSION} (PROTOCOL_VERSION=${PROTOCOL_VERSION}) for ${targets.length} targets…`);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const ldflags = `-s -w -X main.Version=${VERSION} -X main.ProtocolVersion=${PROTOCOL_VERSION}`;

for (const t of targets) {
  const outDir = join(OUT_DIR, t.dir);
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'thunderclaw-host' + t.ext);
  const cmd = `go build -trimpath -ldflags "${ldflags}" -o "${outFile}" .`;
  console.log(`  → ${t.dir}`);
  execSync(cmd, {
    cwd: HOST_DIR,
    env: { ...process.env, GOOS: t.goos, GOARCH: t.goarch, CGO_ENABLED: '0' },
    stdio: 'inherit',
  });
}

console.log(`\n✓ Built ${targets.length} host binaries → dist/host-bin/`);
