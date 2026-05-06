import * as esbuild from 'esbuild';
import { mkdir, copyFile, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist', 'extension');
const XPI = join(ROOT, 'dist', 'thunderclaw.xpi');

const watch = process.argv.includes('--watch');

async function copyStatic() {
  await mkdir(DIST, { recursive: true });
  await copyTree(join(SRC, 'manifest.json'), join(DIST, 'manifest.json'));
  await copyTree(join(SRC, 'ui', 'ai-view.html'), join(DIST, 'ai-view.html'));
  await copyTree(join(SRC, 'icons'), join(DIST, 'icons'));
}

async function copyTree(from, to) {
  if (!existsSync(from)) return;
  const s = await stat(from);
  if (s.isDirectory()) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from)) {
      await copyTree(join(from, entry), join(to, entry));
    }
  } else {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}

const buildOpts = {
  bundle: true,
  format: 'iife',
  target: ['firefox128'],
  loader: { '.png': 'file', '.svg': 'file' },
  logLevel: 'info',
};

async function buildAll() {
  await rm(DIST, { recursive: true, force: true });
  await copyStatic();

  await esbuild.build({
    ...buildOpts,
    entryPoints: [join(SRC, 'background', 'index.ts')],
    outfile: join(DIST, 'background.js'),
  });

  await esbuild.build({
    ...buildOpts,
    entryPoints: [join(SRC, 'ui', 'ai-view.tsx')],
    outfile: join(DIST, 'ai-view.js'),
  });

  await packageXpi();
  console.log(`✓ Built ${relative(ROOT, XPI)}`);
}

async function packageXpi() {
  await rm(XPI, { force: true });
  // zip the DIST folder into XPI. Use system zip; XPI = standard zip.
  execSync(`cd "${DIST}" && zip -qr "${XPI}" .`);
}

if (watch) {
  await buildAll();
  console.log('Watching for changes...');
  // Simple watcher: rebuild on any change under src/
  const { watch: fsWatch } = await import('node:fs');
  let timer;
  fsWatch(SRC, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await buildAll();
      } catch (e) {
        console.error(e);
      }
    }, 200);
  });
} else {
  await buildAll();
}
