#!/usr/bin/env node
// Mozilla AMO 自分发（unlisted）签名。
//
// 用法：
//   AMO_JWT_ISSUER=user:12345:67 AMO_JWT_SECRET=xxx npm run sign
//
// 流程：
//   1. 把 src/manifest.json 加回 experiment_apis（v0.2.1 hotfix 期间被拿掉）
//   2. 重新 build XPI
//   3. 跑 web-ext sign --channel=unlisted —— Mozilla 自动签，几分钟内出包
//   4. 输出签名后的 XPI 到 dist/release/
//
// 签名后的 XPI 不再受 sideload + 未签名限制：
//   - experiment_apis 直接生效 → 直写日历，无导入对话框
//   - TB release 频道（150+）也能装，不用 ESR
//   - 用户可以普通 "拖到 Add-ons 页" 装

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const ISSUER = process.env.AMO_JWT_ISSUER;
const SECRET = process.env.AMO_JWT_SECRET;

if (!ISSUER || !SECRET) {
  console.error('✗ 缺 AMO_JWT_ISSUER 或 AMO_JWT_SECRET 环境变量');
  console.error('');
  console.error('  到 https://addons.mozilla.org/en-US/developers/addon/api/key/ 拿一对，然后：');
  console.error('    AMO_JWT_ISSUER=... AMO_JWT_SECRET=... npm run sign');
  process.exit(1);
}

// ─── 1) 给 manifest 加回 experiment_apis（签名扩展才允许）─────
const manifestPath = join(ROOT, 'src', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const original = JSON.stringify(manifest, null, 2);

if (!manifest.experiment_apis) {
  console.log('==> 加 experiment_apis 到 manifest（签名后才能生效）');
  manifest.experiment_apis = {
    thunderclawCalendar: {
      schema: 'experiments/thunderclawCalendar/schema.json',
      parent: {
        scopes: ['addon_parent'],
        script: 'experiments/thunderclawCalendar/implementation.js',
        paths: [['thunderclawCalendar']],
      },
    },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

let signedOk = false;
try {
  // ─── 2) build XPI（带 experiments/）─────────────────
  console.log('==> 重 build XPI（带 experiments/）');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  // ─── 3) web-ext sign --channel=unlisted ─────────────
  console.log('==> 提交 Mozilla AMO 自动签');
  const artifactsDir = join(ROOT, 'dist', 'signed');
  mkdirSync(artifactsDir, { recursive: true });
  execSync(
    [
      'npx web-ext sign',
      `--api-key="${ISSUER}"`,
      `--api-secret="${SECRET}"`,
      '--channel=unlisted',
      `--source-dir="${join(ROOT, 'dist', 'extension')}"`,
      `--artifacts-dir="${artifactsDir}"`,
      '--no-input',
    ].join(' '),
    { cwd: ROOT, stdio: 'inherit' },
  );
  signedOk = true;
  console.log(`\n✓ 签名 XPI → ${artifactsDir}/`);
} finally {
  // ─── 4) 还原 manifest（签名 XPI 已经包了 experiment_apis 进去；
  //       源码上保持 v0.3.0 的"无 experiment_apis 形态"，下次普通 build 还是 hotfix 状态）
  if (!signedOk) {
    console.log('\n签名失败——还原 src/manifest.json');
  }
  writeFileSync(manifestPath, original);
}
