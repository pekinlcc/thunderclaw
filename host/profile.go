package main

// 找 Thunderbird 的默认 profile 目录。每个平台 profiles.ini 路径不一样。
// 解析规则跟扩展端 OS-specific install 脚本一致：
//   1. [Install*].Default 优先
//   2. 退到 [Profile*].Default=1
//   3. 退到第一个 [Profile*]

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func tbProfilesRoot() string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Thunderbird")
	case "windows":
		appdata := os.Getenv("APPDATA")
		if appdata == "" {
			appdata = filepath.Join(home, "AppData", "Roaming")
		}
		return filepath.Join(appdata, "Thunderbird")
	default:
		return filepath.Join(home, ".thunderbird")
	}
}

// defaultProfilePath 返回默认 profile 的绝对路径。
// IsRelative=1 时 Path 是相对 profilesRoot；IsRelative=0 时是绝对路径。
func defaultProfilePath() (string, error) {
	root := tbProfilesRoot()
	iniPath := filepath.Join(root, "profiles.ini")
	f, err := os.Open(iniPath)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", iniPath, err)
	}
	defer f.Close()

	type section struct {
		name        string
		fields      map[string]string
	}
	var sections []section
	var cur *section
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			s := section{name: line[1 : len(line)-1], fields: map[string]string{}}
			sections = append(sections, s)
			cur = &sections[len(sections)-1]
			continue
		}
		if cur == nil {
			continue
		}
		if i := strings.Index(line, "="); i >= 0 {
			k := strings.TrimSpace(line[:i])
			v := strings.TrimSpace(line[i+1:])
			cur.fields[k] = v
		}
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("scan profiles.ini: %w", err)
	}

	resolve := func(rel string, isRel bool) string {
		if isRel || !filepath.IsAbs(rel) {
			return filepath.Join(root, rel)
		}
		return rel
	}

	// Pass 1: [Install*].Default
	for _, s := range sections {
		if !strings.HasPrefix(s.name, "Install") {
			continue
		}
		if d := s.fields["Default"]; d != "" {
			// Install 段的 Default 是 path，IsRelative 通常隐含为 1
			return resolve(d, true), nil
		}
	}

	// Pass 2: [Profile*].Default=1
	for _, s := range sections {
		if !strings.HasPrefix(s.name, "Profile") {
			continue
		}
		if s.fields["Default"] == "1" {
			path := s.fields["Path"]
			if path == "" {
				continue
			}
			return resolve(path, s.fields["IsRelative"] == "1"), nil
		}
	}

	// Pass 3: 第一个 [Profile*]
	for _, s := range sections {
		if !strings.HasPrefix(s.name, "Profile") {
			continue
		}
		if path := s.fields["Path"]; path != "" {
			return resolve(path, s.fields["IsRelative"] == "1"), nil
		}
	}

	return "", fmt.Errorf("no profile found in %s", iniPath)
}
