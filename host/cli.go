package main

// 探测 / 调用 Claude Code 和 Codex CLI。跟 native-host/cli.mjs 1:1 翻译，
// 行为完全等价（同样的回退路径、同样的环境变量、同样的 timeout 语义）。

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// fallbackPaths 的语义：snap thunderbird spawn 子进程时给的 PATH 很贫瘠，
// 这里手动兜常见的用户级 / 系统 bin 目录，防止 `which claude` / `which codex` 找不着
func fallbackPaths(name string) []string {
	var paths []string
	for _, dir := range fallbackPathDirs() {
		paths = append(paths, filepath.Join(dir, name))
	}
	return paths
}

func fallbackPathDirs() []string {
	home, _ := os.UserHomeDir()
	dirs := []string{
		filepath.Join(home, ".local", "bin"),
		filepath.Join(home, ".npm-global", "bin"),
		filepath.Join(home, ".bun", "bin"),
		filepath.Join(home, ".cargo", "bin"),
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/usr/sbin",
		"/sbin",
	}
	if nvmBins, err := filepath.Glob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin")); err == nil {
		dirs = append(nvmBins, dirs...)
	}
	return dirs
}

func cliPath(extraDirs ...string) string {
	seen := map[string]bool{}
	var dirs []string
	add := func(dir string) {
		if dir == "" || seen[dir] {
			return
		}
		seen[dir] = true
		dirs = append(dirs, dir)
	}
	for _, dir := range extraDirs {
		add(dir)
	}
	for _, dir := range fallbackPathDirs() {
		add(dir)
	}
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		add(dir)
	}
	return strings.Join(dirs, string(os.PathListSeparator))
}

func cliEnv(extra ...string) []string {
	env := make([]string, 0, len(os.Environ())+len(extra)+1)
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "PATH=") {
			continue
		}
		env = append(env, kv)
	}
	env = append(env, "PATH="+cliPath())
	env = append(env, extra...)
	return env
}

// which 优先 PATH 查找，没有的话扫常见位置
func which(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	for _, p := range fallbackPaths(name) {
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			if info.Mode()&0o111 != 0 {
				return p
			}
		}
	}
	return ""
}

func tryVersion(bin string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "--version")
	cmd.Env = cliEnv(filepath.Dir(bin))
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	first := strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0]
	return first
}

type CLIInfo struct {
	Installed bool   `json:"installed"`
	LoggedIn  bool   `json:"loggedIn"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
}

type ProbeResult struct {
	Claude CLIInfo `json:"claude"`
	Codex  CLIInfo `json:"codex"`
}

// ~/.claude/.credentials.json 存在 + 含 claudeAiOauth.accessToken 字段才算登录
func claudeLoggedIn() bool {
	home, _ := os.UserHomeDir()
	credFile := filepath.Join(home, ".claude", ".credentials.json")
	data, err := os.ReadFile(credFile)
	if err != nil {
		return false
	}
	// 不解析整个 JSON——只看 accessToken 字段是否 non-empty 字符串
	// 简化检查：含 "claudeAiOauth" + "accessToken" 字样且不是空串
	s := string(data)
	if !strings.Contains(s, `"claudeAiOauth"`) || !strings.Contains(s, `"accessToken"`) {
		return false
	}
	// 粗略看一下值不是空串
	idx := strings.Index(s, `"accessToken"`)
	if idx < 0 {
		return false
	}
	tail := s[idx+len(`"accessToken"`):]
	// 跳到 ':' 后第一个 '"'
	colonIdx := strings.Index(tail, ":")
	if colonIdx < 0 {
		return false
	}
	tail = tail[colonIdx+1:]
	startQuote := strings.Index(tail, `"`)
	if startQuote < 0 {
		return false
	}
	tail = tail[startQuote+1:]
	endQuote := strings.Index(tail, `"`)
	if endQuote <= 0 { // 空串或找不到关闭引号
		return false
	}
	return true
}

// codex 登录态：~/.codex/auth.json 或 ~/.config/codex/auth.json 存在
func codexLoggedIn() bool {
	home, _ := os.UserHomeDir()
	for _, p := range []string{
		filepath.Join(home, ".codex", "auth.json"),
		filepath.Join(home, ".config", "codex", "auth.json"),
	} {
		if _, err := os.Stat(p); err == nil {
			return true
		}
	}
	return false
}

func probeAll() ProbeResult {
	var res ProbeResult
	if p := which("claude"); p != "" {
		res.Claude = CLIInfo{Installed: true, Path: p, Version: tryVersion(p), LoggedIn: claudeLoggedIn()}
	}
	if p := which("codex"); p != "" {
		res.Codex = CLIInfo{Installed: true, Path: p, Version: tryVersion(p), LoggedIn: codexLoggedIn()}
	}
	return res
}

type llmCallParams struct {
	Engine       string `json:"engine"`
	Prompt       string `json:"prompt"`
	SystemPrompt string `json:"systemPrompt,omitempty"`
	TimeoutMs    int    `json:"timeoutMs,omitempty"`
}

// 默认超时：和 Node 版一致 180s
const defaultTimeoutMs = 180_000

func callLLM(p llmCallParams) (string, error) {
	timeoutMs := p.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = defaultTimeoutMs
	}
	switch p.Engine {
	case "claude":
		return callClaude(p.Prompt, p.SystemPrompt, timeoutMs)
	case "codex":
		return callCodex(p.Prompt, p.SystemPrompt, timeoutMs)
	default:
		return "", fmt.Errorf("unknown engine: %q", p.Engine)
	}
}

// claude --print --max-turns 1 --output-format text (无工具)
// prompt 走 stdin（不走 argv 避免 ARG_MAX）
func callClaude(prompt, systemPrompt string, timeoutMs int) (string, error) {
	bin := which("claude")
	if bin == "" {
		return "", errors.New("claude binary not found")
	}
	args := []string{
		"--print", "--max-turns", "1", "--output-format", "text",
		"--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task",
	}
	if systemPrompt != "" {
		args = append(args, "--append-system-prompt", systemPrompt)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = cliEnv(filepath.Dir(bin))
	cmd.Stdin = strings.NewReader(prompt)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("claude timeout (%dms)", timeoutMs)
	}
	if err != nil {
		stderrTail := stderr.String()
		if len(stderrTail) > 500 {
			stderrTail = stderrTail[:500]
		}
		return "", fmt.Errorf("claude exit error: %v: %s", err, stderrTail)
	}
	return strings.TrimSpace(stdout.String()), nil
}

// codex exec --skip-git-repo-check --color never -o <tmpfile>，最终从 tmpfile 读"最后一条 agent message"
// 跟 Node 版相同：cwd 设到独立 tmp dir 避开 git 仓库检测；NO_COLOR 进 env
func callCodex(prompt, systemPrompt string, timeoutMs int) (string, error) {
	bin := which("codex")
	if bin == "" {
		return "", errors.New("codex binary not found")
	}
	fullPrompt := prompt
	if systemPrompt != "" {
		fullPrompt = systemPrompt + "\n\n---\n\n" + prompt
	}
	workDir, err := os.MkdirTemp("", "thunderclaw-codex-")
	if err != nil {
		return "", fmt.Errorf("mkdtemp: %w", err)
	}
	defer os.RemoveAll(workDir)
	outFile := filepath.Join(workDir, "last.txt")

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	args := []string{"exec", "--skip-git-repo-check", "--color", "never", "-o", outFile}
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = workDir
	cmd.Env = cliEnv(filepath.Dir(bin), "NO_COLOR=1")
	cmd.Stdin = strings.NewReader(fullPrompt)
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf // 不打印进 stdin，但限长以防爆内存
	cmd.Stderr = &stderrBuf

	err = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("codex timeout (%dms)", timeoutMs)
	}
	if err != nil {
		stderrTail := truncate(stderrBuf.String(), 500)
		stdoutHead := truncate(stdoutBuf.String(), 500)
		return "", fmt.Errorf("codex exit error: %v: stderr: %s; stdout-head: %s", err, stderrTail, stdoutHead)
	}
	data, err := os.ReadFile(outFile)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", fmt.Errorf("codex output file missing; stdout-head: %s", truncate(stdoutBuf.String(), 300))
		}
		return "", fmt.Errorf("read codex output: %w", err)
	}
	return strings.TrimSpace(string(data)), nil
}

func truncate(s string, max int) string {
	if len(s) > max {
		return s[:max]
	}
	return s
}
