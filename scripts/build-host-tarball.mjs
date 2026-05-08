#!/usr/bin/env node
// 把所有平台的 Go binary 打包成 tarball + zip 给 release 用。
// Linux 用户优先 .deb；这个 tarball 是 Mac/Win/Linux ARM 等场景的兜底。
//
// 输出：
//   dist/release/thunderclaw-native-host-v<version>.tar.gz
//   dist/release/thunderclaw-native-host-v<version>.zip
//
// 内含：
//   thunderclaw-native-host-v<v>/
//     host-bin/
//       linux-amd64/thunderclaw-host
//       linux-arm64/thunderclaw-host
//       darwin-amd64/thunderclaw-host
//       darwin-arm64/thunderclaw-host
//       windows-amd64/thunderclaw-host.exe
//     scripts/install-native-host.mjs
//     README.md

import { execSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HOST_BIN_DIR = join(ROOT, 'dist', 'host-bin');
const SCRIPTS_DIR = join(ROOT, 'scripts');

const manifest = JSON.parse(readFileSync(join(ROOT, 'src', 'manifest.json'), 'utf8'));
const VERSION = manifest.version;
const PKG_NAME = `thunderclaw-native-host-v${VERSION}`;
const STAGING_PARENT = join(ROOT, 'dist', 'host-staging');
const STAGING = join(STAGING_PARENT, PKG_NAME);
const RELEASE_DIR = join(ROOT, 'dist', 'release');

if (!existsSync(HOST_BIN_DIR)) {
  console.error('✗ dist/host-bin/ missing — run `node scripts/build-host.mjs` first.');
  process.exit(1);
}

console.log(`Building ${PKG_NAME} tarball + zip…`);

rmSync(STAGING_PARENT, { recursive: true, force: true });
mkdirSync(STAGING, { recursive: true });

// 复制所有 binary
cpSync(HOST_BIN_DIR, join(STAGING, 'host-bin'), { recursive: true });

// 复制 install 脚本
mkdirSync(join(STAGING, 'scripts'), { recursive: true });
copyFileSync(
  join(SCRIPTS_DIR, 'install-native-host.mjs'),
  join(STAGING, 'scripts', 'install-native-host.mjs'),
);

// README
const readme = `# ThunderClaw Native Host v${VERSION}

ThunderClaw 的 Native Messaging Host（Go 静态二进制，**无 Node 依赖**）。

## 装

\`\`\`bash
node scripts/install-native-host.mjs
\`\`\`

会自动选当前平台的 binary（host-bin/<os>-<arch>/）复制到对应位置，并写 NMH manifest。

- macOS: \`~/Library/Application Support/ThunderClaw/thunderclaw-host\`
- Windows: \`%LOCALAPPDATA%\\ThunderClaw\\thunderclaw-host.exe\` + 注册表
- Linux: \`~/.local/share/thunderclaw/thunderclaw-host\` + \`~/.thunderbird/native-messaging-hosts/\`

装完**完全退出 Thunderbird**（Mac 是 \`Cmd+Q\`，不是关窗口）再打开。

## 卸

\`\`\`bash
node scripts/install-native-host.mjs uninstall
\`\`\`

## 注意

- 这个包**只装 native host**，不装 XPI 扩展。XPI 在同一 release 的 \`thunderclaw-${VERSION}.xpi\` 资产。
- Linux 用户建议用 \`thunderclaw_${VERSION}_all.deb\` —— 一键装 XPI + native host + 自动启用 policy。
`;
writeFileSync(join(STAGING, 'README.md'), readme);

const tarOut = join(RELEASE_DIR, `${PKG_NAME}.tar.gz`);
mkdirSync(RELEASE_DIR, { recursive: true });
rmSync(tarOut, { force: true });
execSync(`tar -czf "${tarOut}" -C "${STAGING_PARENT}" "${PKG_NAME}"`);
console.log(`  ✓ ${tarOut}`);

const zipOut = join(RELEASE_DIR, `${PKG_NAME}.zip`);
rmSync(zipOut, { force: true });
execSync(`cd "${STAGING_PARENT}" && zip -qr "${zipOut}" "${PKG_NAME}"`);
console.log(`  ✓ ${zipOut}`);

console.log('\n✓ Done.');
