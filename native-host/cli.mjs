// CLI 探测和调用。

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
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
