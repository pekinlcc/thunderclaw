#!/usr/bin/env node
// 把当前构建打包成 .deb（Debian/Ubuntu/Mint 等）。
//
// 前置：必须先跑过 `npm run build` 生成 dist/thunderclaw.xpi。
// 输出：dist/release/thunderclaw_<version>_all.deb

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PKG_DIR = join(ROOT, 'packaging', 'deb');
const HOST_DIR = join(ROOT, 'native-host');
const XPI = join(ROOT, 'dist', 'thunderclaw.xpi');

const manifest = JSON.parse(readFileSync(join(ROOT, 'src', 'manifest.json'), 'utf8'));
const VERSION = manifest.version;
const STAGING = join(ROOT, 'dist', 'deb-staging');

if (!existsSync(XPI)) {
  console.error('✗ XPI not found, run `npm run build` first:', XPI);
  process.exit(1);
}

console.log(`Building thunderclaw_${VERSION}_all.deb …`);

// 清旧 staging
rmSync(STAGING, { recursive: true, force: true });
mkdirSync(STAGING, { recursive: true });

// ─── 文件树 ──────────────────────────────────────
// /usr/lib/thunderclaw/  (native host)
mkdirSync(join(STAGING, 'usr/lib/thunderclaw'), { recursive: true });
for (const f of ['index.mjs', 'cli.mjs', 'protocol.mjs', 'version.mjs']) {
  copyFileSync(join(HOST_DIR, f), join(STAGING, 'usr/lib/thunderclaw', f));
}
// host wrapper
copyFileSync(join(PKG_DIR, 'host-wrapper.sh'), join(STAGING, 'usr/lib/thunderclaw/host'));
chmodSync(join(STAGING, 'usr/lib/thunderclaw/host'), 0o755);

// /usr/lib/mozilla/native-messaging-hosts/thunderclaw.json
mkdirSync(join(STAGING, 'usr/lib/mozilla/native-messaging-hosts'), { recursive: true });
writeFileSync(
  join(STAGING, 'usr/lib/mozilla/native-messaging-hosts/thunderclaw.json'),
  JSON.stringify(
    {
      name: 'thunderclaw',
      description: 'ThunderClaw native messaging host',
      path: '/usr/lib/thunderclaw/host',
      type: 'stdio',
      allowed_extensions: ['thunderclaw@pekinlcc.dev'],
    },
    null,
    2,
  ) + '\n',
);

// 也铺一份到 thunderbird-specific path，覆盖更多 TB 发行版
mkdirSync(join(STAGING, 'usr/lib/thunderbird/native-messaging-hosts'), { recursive: true });
copyFileSync(
  join(STAGING, 'usr/lib/mozilla/native-messaging-hosts/thunderclaw.json'),
  join(STAGING, 'usr/lib/thunderbird/native-messaging-hosts/thunderclaw.json'),
);

// /opt/thunderclaw/thunderclaw.xpi
mkdirSync(join(STAGING, 'opt/thunderclaw'), { recursive: true });
copyFileSync(XPI, join(STAGING, 'opt/thunderclaw/thunderclaw.xpi'));

// ─── DEBIAN/control + maintainer scripts ──────────
mkdirSync(join(STAGING, 'DEBIAN'), { recursive: true });
const control = readFileSync(join(PKG_DIR, 'control.template'), 'utf8').replace(
  '__VERSION__',
  VERSION,
);
writeFileSync(join(STAGING, 'DEBIAN/control'), control);
copyFileSync(join(PKG_DIR, 'postinst'), join(STAGING, 'DEBIAN/postinst'));
copyFileSync(join(PKG_DIR, 'postrm'), join(STAGING, 'DEBIAN/postrm'));
chmodSync(join(STAGING, 'DEBIAN/postinst'), 0o755);
chmodSync(join(STAGING, 'DEBIAN/postrm'), 0o755);

// ─── 跑 dpkg-deb --build；macOS 没 dpkg-deb 时按 .deb ar 格式手工打包 ──────────
const outDir = join(ROOT, 'dist', 'release');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `thunderclaw_${VERSION}_all.deb`);
rmSync(outFile, { force: true });

function hasCommand(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (hasCommand('dpkg-deb')) {
  execSync(`dpkg-deb --root-owner-group --build "${STAGING}" "${outFile}"`, {
    stdio: 'inherit',
  });
} else {
  const parts = join(ROOT, 'dist', 'deb-parts');
  rmSync(parts, { recursive: true, force: true });
  mkdirSync(parts, { recursive: true });
  writeFileSync(join(parts, 'debian-binary'), '2.0\n');
  execSync(
    `tar --uid 0 --gid 0 --uname root --gname root -czf "${join(parts, 'control.tar.gz')}" -C "${join(STAGING, 'DEBIAN')}" .`,
    { stdio: 'inherit' },
  );
  execSync(
    `tar --uid 0 --gid 0 --uname root --gname root --exclude ./DEBIAN -czf "${join(parts, 'data.tar.gz')}" -C "${STAGING}" .`,
    { stdio: 'inherit' },
  );
  execSync(
    `cd "${parts}" && ar -qcS "${outFile}" debian-binary control.tar.gz data.tar.gz`,
    { stdio: 'inherit' },
  );
}
console.log(`\n✓ ${outFile}`);
console.log('\n试装：');
console.log(`  sudo dpkg -i ${outFile}`);
console.log('  sudo apt-get install -f         # 修任何缺失依赖（如 nodejs）\n');
