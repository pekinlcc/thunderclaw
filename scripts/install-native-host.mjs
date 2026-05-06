#!/usr/bin/env node
// ThunderClaw Native Messaging Host 跨平台安装器。
// 支持 Linux / macOS / Windows。
//
// 用法：
//   node scripts/install-native-host.mjs           # 安装
//   node scripts/install-native-host.mjs uninstall # 卸载

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HOST_SRC = join(ROOT, 'native-host');
const NAME = 'thunderclaw';
const EXT_ID = 'thunderclaw@pekinlcc.dev';
const HOME = homedir();
const OS = platform();
const action = process.argv[2] || 'install';

// ─── 路径布局（每个 OS 有差异）────────────────────────────────────────
function pathLayout() {
  if (OS === 'darwin') {
    return {
      libDir: join(HOME, 'Library', 'Application Support', 'ThunderClaw'),
      binDir: join(HOME, '.local', 'bin'),
      wrapperName: 'thunderclaw-host',
      manifestDirs: [
        join(HOME, 'Library', 'Application Support', 'Thunderbird', 'NativeMessagingHosts'),
        join(HOME, 'Library', 'Mozilla', 'NativeMessagingHosts'),
      ],
    };
  }
  if (OS === 'win32') {
    const localApp = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local');
    return {
      libDir: join(localApp, 'ThunderClaw'),
      binDir: join(localApp, 'ThunderClaw'),
      wrapperName: 'thunderclaw-host.bat',
      manifestDirs: [join(localApp, 'ThunderClaw')], // Windows 用注册表，不需要文件目录
      registryKey: 'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\thunderclaw',
    };
  }
  // Linux 及其他
  return {
    libDir: join(HOME, '.local', 'share', 'thunderclaw'),
    binDir: join(HOME, '.local', 'bin'),
    wrapperName: 'thunderclaw-host',
    manifestDirs: [
      join(HOME, '.thunderbird', 'native-messaging-hosts'),
      join(HOME, '.mozilla', 'native-messaging-hosts'),
      join(HOME, 'snap', 'thunderbird', 'common', '.thunderbird', 'native-messaging-hosts'),
      join(HOME, 'snap', 'thunderbird', 'common', '.mozilla', 'native-messaging-hosts'),
    ],
  };
}

// ─── Wrapper 脚本（unix shell / windows batch）──────────────────────────
function wrapperContent(layout) {
  const indexJs = join(layout.libDir, 'index.mjs').replace(/\\/g, OS === 'win32' ? '\\\\' : '/');
  if (OS === 'win32') {
    return [
      '@echo off',
      'rem ThunderClaw NMH wrapper for Windows',
      'where node >nul 2>&1',
      'if errorlevel 1 (',
      '  echo thunderclaw-host: node not found in PATH 1>&2',
      '  exit /b 127',
      ')',
      `node "${indexJs}" %*`,
      '',
    ].join('\r\n');
  }
  // unix
  return [
    '#!/usr/bin/env bash',
    '# ThunderClaw NMH wrapper. 兜常见 PATH，避免 snap/sandbox 给的瘦 PATH 找不到 claude / node。',
    `export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"`,
    '',
    'if [[ -d "$HOME/.nvm/versions/node" ]]; then',
    '  for d in "$HOME/.nvm/versions/node"/*/bin; do',
    '    [[ -d "$d" ]] && PATH="$d:$PATH"',
    '  done',
    '  export PATH',
    'fi',
    '',
    'NODE_BIN=""',
    'for cand in node nodejs; do',
    '  if command -v "$cand" >/dev/null 2>&1; then',
    '    NODE_BIN="$(command -v $cand)"',
    '    break',
    '  fi',
    'done',
    'if [[ -z "$NODE_BIN" ]]; then',
    '  echo "thunderclaw-host: no node binary in PATH (after augment): $PATH" >&2',
    '  exit 127',
    'fi',
    `exec "$NODE_BIN" "${indexJs}" "$@"`,
    '',
  ].join('\n');
}

// ─── manifest JSON ──────────────────────────────────────────────────
function manifestJSON(wrapperPath) {
  return JSON.stringify(
    {
      name: NAME,
      description: 'ThunderClaw native messaging host',
      path: wrapperPath,
      type: 'stdio',
      allowed_extensions: [EXT_ID],
    },
    null,
    2,
  );
}

// ─── install ───────────────────────────────────────────────────────
function install() {
  const layout = pathLayout();
  console.log(`Installing ThunderClaw native host on ${OS}…`);

  // 1) 复制 native-host/*.mjs 到 libDir
  mkdirSync(layout.libDir, { recursive: true });
  for (const f of ['index.mjs', 'cli.mjs', 'protocol.mjs']) {
    copyFileSync(join(HOST_SRC, f), join(layout.libDir, f));
  }
  console.log(`  ✓ library → ${layout.libDir}`);

  // 2) 写 wrapper
  mkdirSync(layout.binDir, { recursive: true });
  const wrapperPath = join(layout.binDir, layout.wrapperName);
  writeFileSync(wrapperPath, wrapperContent(layout));
  if (OS !== 'win32') chmodSync(wrapperPath, 0o755);
  console.log(`  ✓ wrapper → ${wrapperPath}`);

  // 3) 写 manifest
  const manifest = manifestJSON(wrapperPath);
  if (OS === 'win32') {
    // Windows 用注册表：把 manifest 写到 libDir 下，再让注册表指向它
    const manifestPath = join(layout.libDir, 'thunderclaw.json');
    writeFileSync(manifestPath, manifest);
    try {
      execSync(
        `reg add "${layout.registryKey}" /ve /t REG_SZ /d "${manifestPath}" /f`,
        { stdio: 'inherit' },
      );
      console.log(`  ✓ registry → ${layout.registryKey}`);
    } catch (err) {
      console.error(`  ✗ failed to write registry: ${err.message}`);
      console.error(`    手动跑：reg add "${layout.registryKey}" /ve /t REG_SZ /d "${manifestPath}" /f`);
    }
  } else {
    for (const dir of layout.manifestDirs) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${NAME}.json`), manifest);
      console.log(`  ✓ manifest → ${join(dir, `${NAME}.json`)}`);
    }
  }

  console.log('\n✓ Done.\n');
  console.log('下一步：在 Thunderbird 里安装扩展（dist/release/thunderclaw-*.xpi）。');
  if (OS === 'linux') {
    console.log('提示：snap 版 Thunderbird 在 Ubuntu 24.04 上 native messaging 不通——');
    console.log('      请改用 Mozilla 官方 tarball 或 Flatpak 版。');
  }
}

// ─── uninstall ─────────────────────────────────────────────────────
function uninstall() {
  const layout = pathLayout();
  console.log(`Uninstalling ThunderClaw native host on ${OS}…`);
  rmSync(layout.libDir, { recursive: true, force: true });
  rmSync(join(layout.binDir, layout.wrapperName), { force: true });
  if (OS === 'win32') {
    try {
      execSync(`reg delete "${layout.registryKey}" /f`, { stdio: 'inherit' });
    } catch {/* ignore */}
  } else {
    for (const dir of layout.manifestDirs) {
      rmSync(join(dir, `${NAME}.json`), { force: true });
    }
  }
  console.log('✓ Removed.');
}

// ─── dispatch ──────────────────────────────────────────────────────
if (action === 'install') install();
else if (action === 'uninstall') uninstall();
else {
  console.error(`Unknown action: ${action}. Use 'install' or 'uninstall'.`);
  process.exit(1);
}

// 若有 XPI 需要安装也提示一下
const xpi = join(ROOT, 'dist', 'release');
if (existsSync(xpi)) {
  console.log(`XPI 在: ${xpi}/`);
}
