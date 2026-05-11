#!/usr/bin/env node
// Mozilla AMO 自分发（unlisted）签名。
//
// 用法：
//   AMO_JWT_ISSUER=user:12345:67 AMO_JWT_SECRET=xxx npm run sign
//
// 流程：
//   1. 用当前 manifest（不含 experiment_apis）build XPI
//   2. 跑 web-ext sign --channel=unlisted —— Mozilla 自动签，几分钟内出包
//   3. 输出签名后的 XPI 到 dist/signed/
//
// 已知限制：AMO unlisted 频道**不允许 experiment_apis**——那是 privileged extensions
// 才能用的 manifest 字段，需要 Mozilla 内部审批的 system addon 签名。所以签完日历
// 还是走 v0.1.20 的 NMH 导入对话框路径。
//
// 签名后的 XPI 仍然解锁这些：
//   - TB release 频道（150+）能装，不只 ESR
//   - 没有"未签名扩展"告警
//   - 拖到 Add-ons 页直接装（不用 user.js / sideload）
//   - 能走 update_url 自动更新

import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
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

// ─── 1) build XPI（用当前 manifest，不动 experiment_apis）─────
console.log('==> build XPI');
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

// ─── 2) web-ext sign --channel=unlisted ─────────────
console.log('==> 提交 Mozilla AMO 自动签');
const artifactsDir = join(ROOT, 'dist', 'signed');
mkdirSync(artifactsDir, { recursive: true });
const signResult = spawnSync(
  'npx',
  [
    'web-ext',
    'sign',
    `--api-key=${ISSUER}`,
    `--api-secret=${SECRET}`,
    '--channel=unlisted',
    `--source-dir=${join(ROOT, 'dist', 'extension')}`,
    `--artifacts-dir=${artifactsDir}`,
    '--no-input',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);
if (signResult.error) {
  console.error(`✗ web-ext sign 启动失败：${signResult.error.message}`);
  process.exit(1);
}
if (signResult.status !== 0) {
  console.error(`✗ web-ext sign 失败（exit ${signResult.status ?? 'unknown'}）`);
  process.exit(signResult.status ?? 1);
}
console.log(`\n✓ 签名 XPI → ${artifactsDir}/`);
