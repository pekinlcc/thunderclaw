#!/usr/bin/env node
// ThunderClaw Native Messaging Host 跨平台安装器（v0.3.0+：Go binary，无 Node 依赖）。
//
// 用法：
//   node scripts/install-native-host.mjs           # 安装当前平台的 binary
//   node scripts/install-native-host.mjs uninstall # 卸载
//
// 自动选 ${os}-${arch} 子目录下的 binary。需要先跑过 `node scripts/build-host.mjs`
// 或者下载发布包（解压后含 host-bin/<os>-<arch>/thunderclaw-host）。

import { execSync } from 'node:child_process';
import {
  existsSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, rmSync, readFileSync,
} from 'node:fs';
import { homedir, platform, arch } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const NAME = 'thunderclaw';
const EXT_ID = 'thunderclaw@pekinlcc.dev';
const HOME = homedir();

const action = process.argv[2] || 'install';

// ─── 平台映射 ──────────────────────────────────────────
function platformKey() {
  const os = platform(); // 'linux' | 'darwin' | 'win32'
  const a = arch();      // 'x64' | 'arm64' | ...
  const archMap = { x64: 'amd64', arm64: 'arm64' };
  const goarch = archMap[a];
  if (!goarch) throw new Error(`unsupported arch: ${a}`);
  if (os === 'win32') return `windows-${goarch}`;
  return `${os}-${goarch}`;
}

// ─── 各 OS 的安装路径 ────────────────────────────────
function pathLayout() {
  const key = platformKey();
  if (platform() === 'darwin') {
    return {
      libDir: join(HOME, 'Library', 'Application Support', 'ThunderClaw'),
      binName: 'thunderclaw-host',
      hostBinSrc: join(ROOT, 'dist', 'host-bin', key, 'thunderclaw-host'),
      manifestDirs: [
        join(HOME, 'Library', 'Application Support', 'Thunderbird', 'NativeMessagingHosts'),
        join(HOME, 'Library', 'Mozilla', 'NativeMessagingHosts'),
      ],
    };
  }
  if (platform() === 'win32') {
    const localApp = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local');
    return {
      libDir: join(localApp, 'ThunderClaw'),
      binName: 'thunderclaw-host.exe',
      hostBinSrc: join(ROOT, 'dist', 'host-bin', key, 'thunderclaw-host.exe'),
      manifestDirs: [join(localApp, 'ThunderClaw')],
      registryKey: 'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\thunderclaw',
    };
  }
  // Linux
  return {
    libDir: join(HOME, '.local', 'share', 'thunderclaw'),
    binName: 'thunderclaw-host',
    hostBinSrc: join(ROOT, 'dist', 'host-bin', key, 'thunderclaw-host'),
    manifestDirs: [
      join(HOME, '.thunderbird', 'native-messaging-hosts'),
      join(HOME, '.mozilla', 'native-messaging-hosts'),
      join(HOME, 'snap', 'thunderbird', 'common', '.thunderbird', 'native-messaging-hosts'),
      join(HOME, 'snap', 'thunderbird', 'common', '.mozilla', 'native-messaging-hosts'),
    ],
  };
}

function manifestJSON(binPath) {
  return JSON.stringify(
    {
      name: NAME,
      description: 'ThunderClaw native messaging host',
      path: binPath,
      type: 'stdio',
      allowed_extensions: [EXT_ID],
    },
    null,
    2,
  );
}

function install() {
  const layout = pathLayout();
  console.log(`Installing ThunderClaw native host on ${platform()}/${arch()}…`);

  if (!existsSync(layout.hostBinSrc)) {
    console.error(`✗ host binary not found: ${layout.hostBinSrc}`);
    console.error(`  先跑：node scripts/build-host.mjs`);
    console.error(`  或确保你解的发布包里含 host-bin/${platformKey()}/`);
    process.exit(1);
  }

  // 1) 复制 binary 到 libDir
  mkdirSync(layout.libDir, { recursive: true });
  const binDst = join(layout.libDir, layout.binName);
  copyFileSync(layout.hostBinSrc, binDst);
  if (platform() !== 'win32') chmodSync(binDst, 0o755);
  console.log(`  ✓ binary → ${binDst}`);

  // 2) 写 NMH manifest
  const manifest = manifestJSON(binDst);
  if (platform() === 'win32') {
    const manifestPath = join(layout.libDir, 'thunderclaw.json');
    writeFileSync(manifestPath, manifest);
    try {
      execSync(
        `reg add "${layout.registryKey}" /ve /t REG_SZ /d "${manifestPath}" /f`,
        { stdio: 'inherit' },
      );
      console.log(`  ✓ registry → ${layout.registryKey}`);
    } catch (err) {
      console.error(`  ✗ registry write failed: ${err.message}`);
      console.error(`    手动跑：reg add "${layout.registryKey}" /ve /t REG_SZ /d "${manifestPath}" /f`);
    }
  } else {
    for (const dir of layout.manifestDirs) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${NAME}.json`), manifest);
      console.log(`  ✓ manifest → ${join(dir, `${NAME}.json`)}`);
    }
  }

  console.log('\n✓ Done.');
  console.log('下一步：在 Thunderbird 里安装 XPI（dist/release/thunderclaw-*.xpi）。');
  if (platform() === 'linux') {
    console.log('提示：snap 版 Thunderbird 在 Ubuntu 24.04 上 native messaging 不通——');
    console.log('      请改用 Mozilla 官方 tarball 或 Flatpak 版。');
  }
}

function uninstall() {
  const layout = pathLayout();
  console.log(`Uninstalling ThunderClaw native host on ${platform()}…`);
  rmSync(layout.libDir, { recursive: true, force: true });
  if (platform() === 'win32') {
    try {
      execSync(`reg delete "${layout.registryKey}" /f`, { stdio: 'inherit' });
    } catch { /* ignore */ }
  } else {
    for (const dir of layout.manifestDirs) {
      rmSync(join(dir, `${NAME}.json`), { force: true });
    }
  }
  console.log('✓ Removed.');
}

if (action === 'install') install();
else if (action === 'uninstall') uninstall();
else {
  console.error(`Unknown action: ${action}. Use 'install' or 'uninstall'.`);
  process.exit(1);
}

const xpi = join(ROOT, 'dist', 'release');
if (existsSync(xpi)) {
  console.log(`\nXPI 在: ${xpi}/`);
}
