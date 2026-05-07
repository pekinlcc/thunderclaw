#!/usr/bin/env node
// 把 native-host/ + 安装脚本打成 tarball + zip，挂在 GitHub Release 上给 Mac/Win 用户用。
// Linux 用户优先用 .deb（XPI + native host 一起装）；这个 tarball 是给没 .deb 的 OS 兜底。
//
// 输出：
//   dist/release/thunderclaw-native-host-v<version>.tar.gz
//   dist/release/thunderclaw-native-host-v<version>.zip   (Windows 友好)
//
// 用户解包后跑 `node scripts/install-native-host.mjs` 即可——layout 跟 repo 一样，
// install 脚本能直接找到 ../native-host。

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HOST_DIR = join(ROOT, 'native-host');
const SCRIPTS_DIR = join(ROOT, 'scripts');

const manifest = JSON.parse(readFileSync(join(ROOT, 'src', 'manifest.json'), 'utf8'));
const VERSION = manifest.version;
const PKG_NAME = `thunderclaw-native-host-v${VERSION}`;
const STAGING_PARENT = join(ROOT, 'dist', 'host-staging');
const STAGING = join(STAGING_PARENT, PKG_NAME);
const RELEASE_DIR = join(ROOT, 'dist', 'release');

if (!existsSync(join(HOST_DIR, 'version.mjs'))) {
  console.error('✗ native-host/version.mjs missing — run `npm run build` first.');
  process.exit(1);
}

console.log(`Building ${PKG_NAME} tarball + zip…`);

rmSync(STAGING_PARENT, { recursive: true, force: true });
mkdirSync(join(STAGING, 'native-host'), { recursive: true });
mkdirSync(join(STAGING, 'scripts'), { recursive: true });
mkdirSync(RELEASE_DIR, { recursive: true });

// 复制 native-host/ 全部 .mjs + manifest 模板
for (const f of ['index.mjs', 'cli.mjs', 'protocol.mjs', 'version.mjs', 'manifest.template.json']) {
  const src = join(HOST_DIR, f);
  if (existsSync(src)) copyFileSync(src, join(STAGING, 'native-host', f));
}
copyFileSync(join(SCRIPTS_DIR, 'install-native-host.mjs'), join(STAGING, 'scripts', 'install-native-host.mjs'));

// README
const readme = `# ThunderClaw Native Host v${VERSION}

ThunderClaw 的 Native Messaging Host。XPI 扩展通过它跑本地 Claude Code / Codex CLI。

## 装

\`\`\`bash
node scripts/install-native-host.mjs
\`\`\`

会把 \`native-host/*.mjs\` 复制到平台对应位置，并在 Thunderbird 能找到的目录写一份 NMH manifest。

- macOS: \`~/Library/Application Support/ThunderClaw/\`
- Windows: \`%LOCALAPPDATA%\\ThunderClaw\\\` + 注册表
- Linux: \`~/.local/share/thunderclaw/\` + \`~/.thunderbird/native-messaging-hosts/\`

装完**完全退出 Thunderbird**（Mac 上是 \`Cmd+Q\`，不是关窗口）再重开。

## 卸

\`\`\`bash
node scripts/install-native-host.mjs uninstall
\`\`\`

## 注意

- 这个 tarball 只装 native host，不装 XPI 扩展。XPI 在同一个 release 的 \`thunderclaw-${VERSION}.xpi\` 资产里。
- Linux 用户建议直接用 \`thunderclaw_${VERSION}_all.deb\`，一键带 XPI + native host + 自动启用扩展的 policies.json。
`;
writeFileSync(join(STAGING, 'README.md'), readme);

// 打 tar.gz
const tarOut = join(RELEASE_DIR, `${PKG_NAME}.tar.gz`);
rmSync(tarOut, { force: true });
execSync(`tar -czf "${tarOut}" -C "${STAGING_PARENT}" "${PKG_NAME}"`);
console.log(`  ✓ ${tarOut}`);

// 打 zip（Windows 友好）
const zipOut = join(RELEASE_DIR, `${PKG_NAME}.zip`);
rmSync(zipOut, { force: true });
execSync(`cd "${STAGING_PARENT}" && zip -qr "${zipOut}" "${PKG_NAME}"`);
console.log(`  ✓ ${zipOut}`);

console.log('\n✓ Done.');
