package main

// open-calendar-ics RPC：把 .ics 写到 tmp 文件然后显式让 TB 打开它。
// 跟 native-host/cli.mjs 里的 openCalendarICS 行为一致：
//   - 不让 macOS 系统默认 .ics handler（Apple Calendar）抢
//   - Mac: open -a Thunderbird /tmp/.../*.ics
//   - Linux: thunderbird /tmp/.../*.ics
//   - Win: cmd /c start "" thunderbird.exe ...
//
// 60 秒后清理 tmp（TB 此时早把内容读进对话框 / adoptItem 了）

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

type openCalendarICSParams struct {
	ICS string `json:"ics"`
}

type openCalendarICSResult struct {
	OK bool `json:"ok"`
}

func openCalendarICS(p openCalendarICSParams) (openCalendarICSResult, error) {
	if p.ICS == "" {
		return openCalendarICSResult{}, errors.New("openCalendarICS: ics content required")
	}
	dir, err := os.MkdirTemp("", "thunderclaw-cal-")
	if err != nil {
		return openCalendarICSResult{}, fmt.Errorf("mkdtemp: %w", err)
	}
	file := filepath.Join(dir, fmt.Sprintf("event-%d.ics", time.Now().UnixMilli()))
	if err := os.WriteFile(file, []byte(p.ICS), 0o644); err != nil {
		os.RemoveAll(dir)
		return openCalendarICSResult{}, fmt.Errorf("write ics: %w", err)
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		// -a 强制用 TB 打开，无视 LaunchServices 的 .ics 关联
		cmd = exec.Command("open", "-a", "Thunderbird", file)
	case "windows":
		// start "" 避免误吞 thunderbird.exe 当窗口标题
		cmd = exec.Command("cmd", "/c", "start", "", "thunderbird.exe", file)
	default:
		cmd = exec.Command("thunderbird", file)
	}
	// detach：不要等 TB 退出
	if err := cmd.Start(); err != nil {
		os.RemoveAll(dir)
		return openCalendarICSResult{}, fmt.Errorf("spawn thunderbird: %w", err)
	}
	go func() { _ = cmd.Wait() }() // 收回 PID 资源，但不阻塞返回

	// 60s 后清 tmp（同 Node 版逻辑）
	go func() {
		time.Sleep(60 * time.Second)
		_ = os.RemoveAll(dir)
	}()

	return openCalendarICSResult{OK: true}, nil
}
