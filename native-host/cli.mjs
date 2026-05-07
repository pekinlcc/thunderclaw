// CLI 探测和调用。

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileP = promisify(execFile);

// 候选路径：用户常见的 bin 目录。snap Thunderbird spawn 给的 PATH 不够丰富，要兜底。
function fallbackPaths(name) {
  const home = homedir();
  return [
    join(home, '.local', 'bin', name),
    join(home, '.npm-global', 'bin', name),
    join(home, '.bun', 'bin', name),
    join(home, '.cargo', 'bin', name),
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/bin/${name}`,
  ];
}

async function which(name) {
  // 先用 PATH 找一遍
  try {
    const { stdout } = await execFileP('which', [name], { timeout: 3000 });
    const p = stdout.trim();
    if (p) return p;
  } catch {
    /* fallthrough */
  }
  // PATH 找不到就直接探常见位置
  for (const p of fallbackPaths(name)) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function tryVersion(bin) {
  try {
    const { stdout } = await execFileP(bin, ['--version'], { timeout: 5000 });
    return stdout.trim().split('\n')[0];
  } catch {
    return null;
  }
}

async function probeClaude() {
  const path = await which('claude');
  if (!path) return { installed: false, loggedIn: false };
  const version = await tryVersion(path);
  // 登录态判断：~/.claude/.credentials.json 存在且能解析出 accessToken
  // 不直接读 token 字段（避免把它带出本进程），只判存在性
  const credFile = join(homedir(), '.claude', '.credentials.json');
  let loggedIn = false;
  try {
    if (existsSync(credFile)) {
      const raw = readFileSync(credFile, 'utf8');
      const obj = JSON.parse(raw);
      if (obj && obj.claudeAiOauth && typeof obj.claudeAiOauth.accessToken === 'string') {
        loggedIn = true;
      }
    }
  } catch {
    loggedIn = false;
  }
  return { installed: true, path, version, loggedIn };
}

async function probeCodex() {
  const path = await which('codex');
  if (!path) return { installed: false, loggedIn: false };
  const version = await tryVersion(path);
  // Codex 登录态：~/.codex/auth.json 是常见路径
  const candidates = [
    join(homedir(), '.codex', 'auth.json'),
    join(homedir(), '.config', 'codex', 'auth.json'),
  ];
  const loggedIn = candidates.some((p) => existsSync(p));
  return { installed: true, path, version, loggedIn };
}

export async function probeAll() {
  const [claude, codex] = await Promise.all([probeClaude(), probeCodex()]);
  return { claude, codex };
}

// 调用 claude -p 跑非交互式推理。
// 输入 prompt 走 stdin，避免命令行长度限制。
export async function callClaude({ prompt, systemPrompt, timeoutMs = 180000 }) {
  const claudePath = await which('claude');
  if (!claudePath) throw new Error('claude binary not found');
  return new Promise((resolve, reject) => {
    const args = ['--print', '--max-turns', '1', '--output-format', 'text'];
    if (systemPrompt) {
      args.push('--append-system-prompt', systemPrompt);
    }
    // 为安全起见，禁用一切工具——我们只要文本生成
    args.push('--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task');

    const child = spawn(claudePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: process.env.PATH },
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, timeoutMs);

    child.stdout.on('data', (b) => (stdout += b.toString('utf8')));
    child.stderr.on('data', (b) => (stderr += b.toString('utf8')));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return reject(new Error(`claude timeout (${timeoutMs}ms)`));
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${stderr.slice(0, 500)}`));
      resolve(stdout.trim());
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// 调用 codex exec 跑非交互式推理。
// 关键点：
//  - codex exec 的 stdout 会含 banner / 推理 / turn marker 等噪音
//  - 用 `-o <file>` 把"最后一条 agent message"单独写到文件，干净
//  - `--skip-git-repo-check` 因为 native host 进程的 cwd 不一定是 git 仓库
//  - prompt 走 stdin 避免命令行长度限制
export async function callCodex({ prompt, systemPrompt, timeoutMs = 180000 }) {
  const codexPath = await which('codex');
  if (!codexPath) throw new Error('codex binary not found');
  // Codex 没有 --append-system-prompt，把 system prompt 拼在 user prompt 前面
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
  const workDir = mkdtempSync(join(tmpdir(), 'thunderclaw-codex-'));
  const outFile = join(workDir, 'last.txt');
  return new Promise((resolve, reject) => {
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--color', 'never',
      '-o', outFile,
    ];
    const child = spawn(codexPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: process.env.PATH, NO_COLOR: '1' },
    });

    let stderr = '';
    let killed = false;
    const cleanup = () => {
      try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
    };
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, timeoutMs);

    child.stdout.on('data', () => { /* 不要 buffer 整个 stdout，会爆内存 */ });
    child.stderr.on('data', (b) => (stderr += b.toString('utf8')));
    child.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        cleanup();
        return reject(new Error(`codex timeout (${timeoutMs}ms)`));
      }
      if (code !== 0) {
        cleanup();
        return reject(new Error(`codex exit ${code}: ${stderr.slice(0, 500)}`));
      }
      let text = '';
      try {
        text = readFileSync(outFile, 'utf8');
      } catch (err) {
        cleanup();
        return reject(new Error(`codex output file missing: ${err.message}`));
      }
      cleanup();
      resolve(text.trim());
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();
  });
}

// 统一入口：根据 engine 路由到对应 CLI。
// 严格匹配——上层（扩展）已经按用户在 intro 里选的 cli 决定了 engine，
// 这里悄悄回退到别的 CLI 只会让"UI 选了 Codex 实际跑了 Claude"这种 bug 更难诊断。
export function callLLM({ engine, prompt, systemPrompt, timeoutMs }) {
  if (engine === 'claude') return callClaude({ prompt, systemPrompt, timeoutMs });
  if (engine === 'codex') return callCodex({ prompt, systemPrompt, timeoutMs });
  throw new Error(`unknown engine: ${engine}`);
}
